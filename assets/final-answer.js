// worker.js (code related to job processing)
messageQueue.process(async (job) => {
  const { threadId, timestamp } = job.data;
  const jobId = job.id;

  // Get jobs with the same threadId
  const relatedJobs = await getJobsByThreadId(threadId);
  if (relatedJobs.length === 0) return;

  // Sort jobs by timestamp to find the oldest job
  relatedJobs.sort((a, b) => a.data.timestamp - b.data.timestamp);

  // Check if thread is locked
  const lockKey = `lock_thread_${threadId}`;
  const isLocked = await redisConnection.exists(lockKey);

  // If thread is locked, put job back in delayed state to retry later
  if (isLocked) {
    console.log(`⏳ Thread ${threadId} is locked, setting job ${jobId} to process later`);
    // Delay job for 5 more seconds to retry
    await job.moveToDelayed(Date.now() + 5000);
    return;
  }

  // Only process if current job is the oldest (or same batch as oldest)
  if (relatedJobs[0].id !== jobId) {
    console.log(`⏭️ Skipping job ${jobId}, not the oldest job for thread ${threadId}`);
    return;
  }

  await processMessages(threadId, relatedJobs);
});

// Function to process all messages for a thread
async function processMessages(threadId, jobs) {
  const lockKey = `lock_thread_${threadId}`;
  // Use Redis lock with 5 minute expiration and store processing start timestamp
  const processingTimestamp = Date.now();
  const lockValue = processingTimestamp.toString();

  const lock = await redisConnection.set(lockKey, lockValue, {
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

    // Save the max timestamp processed in this batch
    const maxTimestamp = Math.max(...jobs.map(job => job.data.timestamp));
    await redisConnection.set(`last_processed_${threadId}`, maxTimestamp.toString());

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

    // Check if new jobs were added during processing
    const newerJobs = await getNewerJobsByThreadId(threadId, maxTimestamp);
    if (newerJobs.length > 0) {
      console.log(`📣 Detected ${newerJobs.length} new messages for thread ${threadId}, activating processing`);
      // Get the first job in the new jobs list and move it to active state immediately
      // to start a new processing cycle
      if (newerJobs.length > 0) {
        await newerJobs[0].moveToActive();
      }
    }

  } catch (error) {
    console.error(`❌ Error processing thread ${threadId}:`, error);
  } finally {
    // Only remove lock if it still has the original value (avoid removing another process's lock)
    const currentLock = await redisConnection.get(lockKey);
    if (currentLock === lockValue) {
      await redisConnection.del(lockKey);
    }
  }
}

// Add function to get jobs newer than a given timestamp
export async function getNewerJobsByThreadId(threadId, timestamp) {
  // Get jobIds from thread's Set
  const jobIds = await redisConnection.sMembers(`bull:threadJobs:${threadId}`);

  // If no jobs, return empty array
  if (!jobIds || jobIds.length === 0) {
    return [];
  }

  // Get all jobs
  const allJobs = await Promise.all(
    jobIds.map(id => messageQueue.getJob(id))
  );

  // Filter jobs with timestamp greater than the given timestamp
  const newerJobs = allJobs
    .filter(Boolean)
    .filter(job => job.data.timestamp > timestamp)
    .sort((a, b) => a.data.timestamp - b.data.timestamp);

  return newerJobs;
} 