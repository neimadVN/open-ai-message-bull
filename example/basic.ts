import { AssistantMessageQueue } from '../src';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runExample() {
  const requiredEnvVars = ['REDIS_URL', 'OPENAI_API_KEY', 'OPENAI_ASSISTANT_ID'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }

  // Create assistant message queue
  const assistantQueue = new AssistantMessageQueue({
    redisUrl: process.env.REDIS_URL!,
    openAIApiKey: process.env.OPENAI_API_KEY!,
    assistantId: process.env.OPENAI_ASSISTANT_ID!,
    messageDelay: 5000, // 5 seconds delay for demo purposes
  });

  // Create event listeners for worker events
  const worker = assistantQueue.startWorker();
  worker.on('completed', job => {
    console.log(`✅ Job ${job.id} completed for thread ${job.data.threadId}`);
    console.log('Result:', job.returnvalue);
  });
  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed for thread ${job?.data.threadId}:`, err);
  });
  worker.on('active', job => {
    console.log(`🚀 Processing jobs for thread ${job.data.threadId}...`);
  });

  // This is the ID of an existing thread from OpenAI
  // You would need to create one first using the OpenAI API
  const threadId = process.env.THREAD_ID || 'thread_abc123';

  try {
    console.log('=== Demo: Sequential messages in same thread ===');
    await sequentialMessages(assistantQueue, threadId);
  } catch (error) {
    console.error('Demo failed with error:', error);
  } finally {
    // Wait a bit to let processing complete
    console.log('Waiting for job processing to complete...');
    setTimeout(async () => {
      await assistantQueue.close();
      console.log('Queue closed.');
      process.exit(0);
    }, 60000);
  }
}

async function sequentialMessages(assistantQueue: AssistantMessageQueue, threadId: string) {
  // Add three messages in quick succession
  console.log('Adding batch 1 messages...');
  const startTime = Date.now();
  
  await assistantQueue.addMessageToThread(threadId, 'Message 1');
  await assistantQueue.addMessageToThread(threadId, 'Message 2');
  await assistantQueue.addMessageToThread(threadId, 'Message 3');
  
  console.log(`Batch 1 added in ${Date.now() - startTime}ms`);
  
  // After the delay expires (messageDelay), the worker will process batch 1
  // Then, add more messages to the same thread
  setTimeout(async () => {
    console.log('Adding batch 2 messages...');
    const batchTime = Date.now();
    
    await assistantQueue.addMessageToThread(threadId, 'Message 4');
    await assistantQueue.addMessageToThread(threadId, 'Message 5');
    
    console.log(`Batch 2 added in ${Date.now() - batchTime}ms`);
    
    // Add one more message after a short delay
    setTimeout(async () => {
      console.log('Adding final message...');
      const finalTime = Date.now();
      
      await assistantQueue.addMessageToThread(threadId, 'Message 6');
      
      console.log(`Final message added in ${Date.now() - finalTime}ms`);
    }, 3000);
  }, 7000); // This is a bit longer than our messageDelay (5000ms)
}

// Run the example
runExample().catch(err => {
  console.error('Example failed:', err);
  process.exit(1);
}); 