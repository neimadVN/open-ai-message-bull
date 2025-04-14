// queue.js
import Queue from "bull";
import { createClient } from "redis";

export const redisConnection = createClient({ url: "redis://localhost:6379" });
await redisConnection.connect();

// Create queue with Bull
export const messageQueue = new Queue("messageQueue", {
  redis: {
    host: "localhost",
    port: 6379,
  }
});

/**
 * Add message to thread.
 * Each job contains 1 message and has jobId format: thread_<threadId>_<timestamp>
 * Also saves jobId to a Set in Redis for efficient lookup
 */
export async function addMessageToThread(threadId, message) {
  const timestamp = Date.now();
  const jobId = `thread_${threadId}_${timestamp}`;
  
  // Add job to queue
  await messageQueue.add(jobId, { threadId, message, timestamp }, {
    delay: 10000, // Delay 10 seconds to batch messages
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
  });
  
  // Save jobId to thread's Set for quick queries
  await redisConnection.sAdd(`bull:threadJobs:${threadId}`, jobId);
  
  console.log(`📝 Added message to thread ${threadId}: ${message}`);
}

/**
 * Get all jobs with jobId starting with "thread_<threadId>_"
 * Using Redis Set for lookup instead of KEYS command
 */
export async function getJobsByThreadId(threadId) {
  // Get jobIds from thread's Set
  const jobIds = await redisConnection.sMembers(`bull:threadJobs:${threadId}`);
  
  // If no jobs, return empty array
  if (!jobIds || jobIds.length === 0) {
    return [];
  }
  
  // Fetch jobs in batches for better performance
  const batchSize = 20;
  const jobs = [];
  
  for (let i = 0; i < jobIds.length; i += batchSize) {
    const batchIds = jobIds.slice(i, i + batchSize);
    const batchJobs = await Promise.all(
      batchIds.map(id => messageQueue.getJob(id))
    );
    jobs.push(...batchJobs.filter(Boolean));
  }
  
  return jobs;
}

/**
 * Remove jobId from thread's Set after job is processed
 */
export async function removeJobsFromThreadIndex(threadId, jobIds) {
  if (jobIds.length === 0) return;
  
  await redisConnection.sRem(`bull:threadJobs:${threadId}`, ...jobIds);
}

// worker.js
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Function to check OpenAI run status with exponential backoff
 */
async function waitForRunCompletion(threadId, runId) {
  let status = "in_progress";
  let delay = 1000; // Start with 1 second
  const maxDelay = 15000; // Maximum 15 seconds
  const maxWaitTime = 300000; // Maximum 5 minutes
  const startTime = Date.now();
  
  while (["in_progress", "queued", "requires_action"].includes(status)) {
    // Check for max wait time
    if (Date.now() - startTime > maxWaitTime) {
      throw new Error(`Run timeout exceeded for thread ${threadId}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Check status
    const checkRun = await openai.beta.threads.runs.retrieve(threadId, runId);
    status = checkRun.status;
    
    // Exponential backoff with max limit
    delay = Math.min(delay * 1.5, maxDelay);
  }
  
  if (status !== "completed") {
    throw new Error(`Run ended with status: ${status} for thread ${threadId}`);
  }
  
  return status;
}

/**
 * Process all messages for a thread.
 * jobs: list of jobs with the same threadId (each job contains 1 message).
 */
async function processMessages(threadId, jobs) {
  const lockKey = `lock_thread_${threadId}`;
  // Use Redis lock with 5 minute expiration
  const lock = await redisConnection.set(lockKey, "locked", {
    NX: true,
    EX: 300
  });
  
  if (!lock) {
    console.log(`⚠️ Thread ${threadId} is already being processed.`);
    return;
  }
  
  try {
    // Group messages from jobs and sort by timestamp
    jobs.sort((a, b) => a.data.timestamp - b.data.timestamp);
    const messages = jobs.map(job => job.data.message);
    const combinedMessage = messages.join("\n");
    
    console.log(`🚀 Processing ${messages.length} messages for thread ${threadId}...`);
    
    // Send grouped message to OpenAI
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: combinedMessage,
    });
    
    // Call OpenAI to execute run for thread
    console.log("🔄 Calling OpenAI API...");
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: "your-assistant-id",
      instructions: "Reply to all messages logically.",
    });
    
    await waitForRunCompletion(threadId, run.id);
    console.log(`✅ OpenAI has completed the response for thread ${threadId}`);
    
    // Get all jobIds to remove from index
    const jobIds = jobs.map(job => job.id);
    
    // Remove jobs from queue
    await Promise.all(jobs.map(job => job.remove()));
    
    // Remove jobIds from index
    await removeJobsFromThreadIndex(threadId, jobIds);
    
  } catch (error) {
    console.error(`❌ Error processing thread ${threadId}:`, error);
    // In case of error, we can decide whether to retry
    // Here, we let jobs retry automatically according to retry configuration
  } finally {
    await redisConnection.del(lockKey);
  }
}

/**
 * Bull Worker: When a job is activated, check if it's the oldest unprocessed job
 * If yes, get all jobs with the same threadId and process them together
 */
messageQueue.process(async (job) => {
  const { threadId, timestamp } = job.data;
  const jobId = job.id;
  
  // Get jobs with the same threadId
  const relatedJobs = await getJobsByThreadId(threadId);
  if (relatedJobs.length === 0) return;
  
  // Sort jobs by timestamp to find the oldest job
  relatedJobs.sort((a, b) => a.data.timestamp - b.data.timestamp);
  
  // Only process if current job is the oldest (or same batch as oldest)
  if (relatedJobs[0].id !== jobId) {
    console.log(`⏭️ Skipping job ${jobId}, not the oldest job for thread ${threadId}`);
    return;
  }
  
  await processMessages(threadId, relatedJobs);
});

console.log("👷 Worker is running...");

// app.js
import { addMessageToThread } from "./queue.js";

async function main() {
  try {
    console.log("=== Test 1: Sequential messages in same thread ===");
    await testSequentialMessages();
    
    // Exit after tests complete
    setTimeout(() => {
      console.log("Tests completed, exiting process");
      process.exit(0);
    }, 60000);
  } catch (error) {
    console.error("Test failed with error:", error);
    process.exit(1);
  }
}

async function testSequentialMessages() {
  const startTime = Date.now();
  
  // Add messages to thread "thread-123"
  await addMessageToThread("thread-123", "Message 1");
  await addMessageToThread("thread-123", "Message 2");
  await addMessageToThread("thread-123", "Message 3");
  console.log(`Batch 1 added in ${Date.now() - startTime}ms`);
  
  // After 11 seconds (after job delay of 10 seconds expires), worker will process batch 1
  // Then, add more messages to the same thread
  setTimeout(async () => {
    const batchTime = Date.now();
    await addMessageToThread("thread-123", "Message 4");
    await addMessageToThread("thread-123", "Message 5");
    console.log(`Batch 2 added in ${Date.now() - batchTime}ms`);
    
    // Add one more message after 3 more seconds
    setTimeout(async () => {
      const finalTime = Date.now();
      await addMessageToThread("thread-123", "Message 6");
      console.log(`Final message added in ${Date.now() - finalTime}ms`);
    }, 3000);
  }, 11000);
} 