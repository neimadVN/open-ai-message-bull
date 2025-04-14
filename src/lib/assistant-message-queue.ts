import Queue from 'bull';
import { createClient } from 'redis';
import OpenAI from 'openai';
import { 
  AssistantMessageQueueOptions, 
  MessageJobData, 
  ProcessingResult,
  QueueStatus,
  ToolCall,
  ToolOutput
} from '../types';

/**
 * AssistantMessageQueue manages message queues for OpenAI's Assistant API
 * to handle batching messages and processing them efficiently.
 */
export class AssistantMessageQueue {
  private queue: Queue.Queue<MessageJobData>;
  private worker: Queue.Queue<MessageJobData> | null = null;
  private redisClient: ReturnType<typeof createClient>;
  private openai: OpenAI;
  private options: Required<AssistantMessageQueueOptions>;

  /**
   * Creates a new AssistantMessageQueue instance
   * 
   * @param options Configuration options for the queue
   */
  constructor(options: AssistantMessageQueueOptions) {
    // Set default options
    this.options = {
      queuePrefix: 'assistant',
      messageDelay: 10000,
      maxAttempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      concurrency: 5,
      defaultInstructions: 'Reply to all messages logically.',
      lockDuration: 300000,
      removeOnComplete: true,
      handleRequiresAction: null,
      ...options
    } as Required<AssistantMessageQueueOptions>;

    // Initialize Redis client
    this.redisClient = createClient({ url: this.options.redisUrl });
    
    // Initialize OpenAI client
    this.openai = new OpenAI({ apiKey: this.options.openAIApiKey });

    // Initialize queue
    const redisUrl = new URL(this.options.redisUrl);
    this.queue = new Queue<MessageJobData>(`${this.options.queuePrefix}MessageQueue`, {
      redis: {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port || '6379'),
        username: redisUrl.username || undefined,
        password: redisUrl.password || undefined,
      }
    });
  }

  /**
   * Connects to Redis if not already connected
   */
  private async ensureRedisConnection(): Promise<void> {
    if (!this.redisClient.isOpen) {
      await this.redisClient.connect();
    }
  }

  /**
   * Creates a new thread
   * 
   * @param metadata Optional metadata for the thread
   * @returns Created thread ID
   */
  async createThread(metadata?: Record<string, string>): Promise<string> {
    const params: Record<string, any> = {};
    if (metadata) {
      params.metadata = metadata;
    }

    const thread = await this.openai.beta.threads.create(params);
    return thread.id;
  }

  /**
   * Retrieves a thread
   * 
   * @param threadId Thread ID
   * @returns Thread object
   */
  async getThread(threadId: string) {
    return this.openai.beta.threads.retrieve(threadId);
  }

  /**
   * Creates a message in a thread
   * 
   * @param threadId Thread ID
   * @param content Message content
   * @returns Created message
   */
  async createMessage(threadId: string, content: string) {
    return this.openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content
    });
  }

  /**
   * Creates and starts a run for a thread
   * 
   * @param threadId Thread ID
   * @param options Run options
   * @returns Created run
   */
  async createRun(threadId: string, options?: {
    instructions?: string;
    tools?: any[];
    metadata?: Record<string, string>;
  }) {
    return this.openai.beta.threads.runs.create(threadId, {
      assistant_id: this.options.assistantId,
      ...(options?.instructions && { instructions: options.instructions }),
      ...(options?.tools && { tools: options.tools }),
      ...(options?.metadata && { metadata: options.metadata })
    });
  }

  /**
   * Cancels a run
   * 
   * @param threadId Thread ID
   * @param runId Run ID
   * @returns Cancelled run
   */
  async cancelRun(threadId: string, runId: string) {
    return this.openai.beta.threads.runs.cancel(threadId, runId);
  }

  /**
   * Lists messages in a thread
   * 
   * @param threadId Thread ID
   * @param options Pagination options
   * @returns List of messages
   */
  async listMessages(threadId: string, options?: {
    limit?: number;
    order?: 'asc' | 'desc';
    after?: string;
    before?: string;
  }) {
    return this.openai.beta.threads.messages.list(threadId, options);
  }

  /**
   * Submit tool outputs for a run that requires action
   * 
   * @param threadId Thread ID
   * @param runId Run ID
   * @param toolOutputs Tool outputs
   * @returns Updated run
   */
  async submitToolOutputs(threadId: string, runId: string, toolOutputs: ToolOutput[]) {
    return this.openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: toolOutputs
    });
  }

  /**
   * Adds a message to a thread
   * 
   * @param threadId OpenAI thread ID
   * @param message Message content
   * @param instructions Optional custom instructions for this message
   * @returns The job ID
   */
  async addMessageToThread(threadId: string, message: string, instructions?: string): Promise<string> {
    await this.ensureRedisConnection();
    
    const timestamp = Date.now();
    const jobId = `thread_${threadId}_${timestamp}`;
    
    // Add job to queue
    await this.queue.add(
      jobId,
      {
        threadId,
        message,
        timestamp,
        instructions
      }, 
      {
        jobId,
        delay: this.options.messageDelay,
        attempts: this.options.maxAttempts,
        backoff: {
          type: this.options.backoff.type ?? 'exponential',
          delay: this.options.backoff.delay
        },
        removeOnComplete: this.options.removeOnComplete
      }
    );
    
    // Save jobId to thread's job Set for efficient lookup
    await this.redisClient.sAdd(`${this.options.queuePrefix}:threadJobs:${threadId}`, jobId);
    
    return jobId;
  }

  /**
   * Gets all jobs for a specific thread
   * 
   * @param threadId OpenAI thread ID
   * @returns Array of jobs for the thread
   */
  async getJobsByThreadId(threadId: string): Promise<Queue.Job<MessageJobData>[]> {
    await this.ensureRedisConnection();
    
    // Get jobIds from thread's Set
    const jobIds = await this.redisClient.sMembers(`${this.options.queuePrefix}:threadJobs:${threadId}`);
    
    if (!jobIds || jobIds.length === 0) {
      return [];
    }
    
    // Fetch jobs in batches for better performance
    const batchSize = 20;
    const jobs: Queue.Job<MessageJobData>[] = [];
    
    for (let i = 0; i < jobIds.length; i += batchSize) {
      const batchIds = jobIds.slice(i, i + batchSize);
      const batchJobs = await Promise.all(
        batchIds.map(id => this.queue.getJob(id))
      );
      jobs.push(...batchJobs.filter(Boolean) as Queue.Job<MessageJobData>[]);
    }
    
    return jobs;
  }

  /**
   * Gets newer jobs for a thread that were created after a specific timestamp
   * 
   * @param threadId OpenAI thread ID
   * @param timestamp Timestamp to filter jobs by
   * @returns Array of jobs newer than the timestamp
   */
  async getNewerJobsByThreadId(threadId: string, timestamp: number): Promise<Queue.Job<MessageJobData>[]> {
    const allJobs = await this.getJobsByThreadId(threadId);
    
    // Filter and sort jobs by timestamp
    return allJobs
      .filter(job => job.data.timestamp > timestamp)
      .sort((a, b) => a.data.timestamp - b.data.timestamp);
  }

  /**
   * Removes job IDs from thread's job index
   * 
   * @param threadId OpenAI thread ID
   * @param jobIds Job IDs to remove
   */
  async removeJobsFromThreadIndex(threadId: string, jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    
    await this.ensureRedisConnection();
    
    // Need to split arrays to handle Redis sRem correctly
    // Redis expects key as first arg, and members as rest of args
    await this.redisClient.sRem(`${this.options.queuePrefix}:threadJobs:${threadId}`, jobIds);
  }

  /**
   * Waits for an OpenAI run to complete
   * 
   * @param threadId OpenAI thread ID
   * @param runId OpenAI run ID
   * @returns The final status of the run
   */
  private async waitForRunCompletion(threadId: string, runId: string): Promise<string> {
    let status = "in_progress";
    let delay = 1000; // Start with 1 second
    const maxDelay = 15000; // Maximum delay of 15 seconds
    const maxWaitTime = 300000; // Maximum wait time of 5 minutes
    const startTime = Date.now();
    
    while (["in_progress", "queued"].includes(status)) {
      // Check for timeout
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`Run timeout exceeded for thread ${threadId}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Check status
      const checkRun = await this.openai.beta.threads.runs.retrieve(threadId, runId);
      status = checkRun.status;
      
      // If run requires action and we have a handler, call it
      if (status === "requires_action" && this.options.handleRequiresAction) {
        // Handle function calling
        if (checkRun.required_action?.type === "submit_tool_outputs") {
          const toolCalls = checkRun.required_action.submit_tool_outputs.tool_calls.map(toolCall => ({
            id: toolCall.id,
            type: 'function' as const,
            function: {
              name: (toolCall as any).function.name,
              arguments: (toolCall as any).function.arguments
            }
          }));
          
          try {
            // Process function calls with the provided handler
            const toolOutputs = await this.options.handleRequiresAction(threadId, runId, toolCalls);
            
            // Submit tool outputs
            await this.submitToolOutputs(threadId, runId, toolOutputs);
            
            // Reset status to continue polling
            status = "in_progress";
          } catch (error) {
            console.error(`Error handling function call for thread ${threadId}:`, error);
            throw error;
          }
        }
      }
      
      // Exponential backoff with maximum limit
      delay = Math.min(delay * 1.5, maxDelay);
    }
    
    if (status !== "completed") {
      throw new Error(`Run ended with status: ${status} for thread ${threadId}`);
    }
    
    return status;
  }

  /**
   * Processes a batch of messages for a thread
   * 
   * @param threadId OpenAI thread ID
   * @param jobs Array of jobs to process
   * @returns Processing result
   */
  private async processMessages(threadId: string, jobs: Queue.Job<MessageJobData>[]): Promise<ProcessingResult> {
    const lockKey = `${this.options.queuePrefix}:lock_thread_${threadId}`;
    
    // Use Redis lock with expiration time to prevent concurrent processing
    const processingTimestamp = Date.now();
    const lockValue = processingTimestamp.toString();
    
    const lock = await this.redisClient.set(lockKey, lockValue, {
      NX: true,
      EX: Math.floor(this.options.lockDuration / 1000)
    });
    
    if (!lock) {
      throw new Error(`Thread ${threadId} is already being processed.`);
    }
    
    try {
      // Group messages from jobs and sort by timestamp
      jobs.sort((a, b) => a.data.timestamp - b.data.timestamp);
      const messages = jobs.map(job => job.data.message);
      const combinedMessage = messages.join("\n");
      
      // Get instructions from the most recent job, or use default
      const instructions = jobs[jobs.length - 1].data.instructions || this.options.defaultInstructions;
      
      // Save max timestamp for checking newer messages later
      const maxTimestamp = Math.max(...jobs.map(job => job.data.timestamp));
      await this.redisClient.set(`${this.options.queuePrefix}:last_processed_${threadId}`, maxTimestamp.toString());
      
      // Send message to OpenAI
      await this.createMessage(threadId, combinedMessage);
      
      // Start a run for the thread
      const run = await this.createRun(threadId, { instructions });
      
      // Wait for run to complete
      const status = await this.waitForRunCompletion(threadId, run.id);
      
      // Get all jobIds to remove from index
      const jobIds = jobs.map(job => job.id).filter(Boolean) as string[];
      
      // Remove jobs from queue
      await Promise.all(jobs.map(job => job.remove()));
      
      // Remove jobIds from index
      await this.removeJobsFromThreadIndex(threadId, jobIds);
      
      // Check for newer jobs that were created during processing
      const newerJobs = await this.getNewerJobsByThreadId(threadId, maxTimestamp);
      if (newerJobs.length > 0 && newerJobs[0]) {
        // Activate the oldest new job immediately to start a new processing cycle
        await newerJobs[0].promote();
      }
      
      return {
        threadId,
        messagesProcessed: jobs.length,
        processedJobIds: jobIds,
        runId: run.id,
        status
      };
      
    } catch (error) {
      throw error;
    } finally {
      // Only remove lock if it's still the same value we set
      // This prevents removing a lock set by another process
      const currentLock = await this.redisClient.get(lockKey);
      if (currentLock === lockValue) {
        await this.redisClient.del(lockKey);
      }
    }
  }

  /**
   * Starts the worker to process messages
   * 
   * @returns The worker queue instance
   */
  startWorker(): Queue.Queue<MessageJobData> {
    if (this.worker) {
      return this.worker;
    }
    
    // Ensure Redis connection
    this.ensureRedisConnection();
    
    // In Bull, the queue is also used as the worker
    this.worker = this.queue;
    
    // Set up the processing function
    this.worker.process(this.options.concurrency, async (job: Queue.Job<MessageJobData>) => {
      const { threadId } = job.data;
      const jobId = job.id as string;
      
      // Get all jobs for this thread
      const relatedJobs = await this.getJobsByThreadId(threadId);
      if (relatedJobs.length === 0) return;
      
      // Sort jobs by timestamp to find the oldest
      relatedJobs.sort((a, b) => a.data.timestamp - b.data.timestamp);
      
      // Check if thread is locked
      const lockKey = `${this.options.queuePrefix}:lock_thread_${threadId}`;
      const isLocked = await this.redisClient.exists(lockKey);
      
      // If locked, delay the job to retry later
      if (isLocked) {
        // Requeue the job with a delay
        await this.queue.add(
          `thread_${threadId}_${Date.now()}`,
          job.data,
          {
            delay: 5000
          }
        );
        await job.remove();
        return;
      }
      
      // Only process if this job is the oldest (or same batch as oldest)
      if (relatedJobs[0].id !== jobId) {
        return;
      }
      
      // Process messages in batch
      return this.processMessages(threadId, relatedJobs);
    });
    
    return this.worker;
  }

  /**
   * Stops the worker and cleans up resources
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    
    if (this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
  }

  /**
   * Gets the current status of the queue
   * 
   * @returns Queue status information
   */
  async getQueueStatus(): Promise<QueueStatus> {
    return {
      activeCount: await this.queue.getActiveCount(),
      waitingCount: await this.queue.getWaitingCount(),
      delayedCount: await this.queue.getDelayedCount(),
      completedCount: await this.queue.getCompletedCount(),
      failedCount: await this.queue.getFailedCount()
    };
  }

  /**
   * Gets the queue instance
   * 
   * @returns The Bull Queue instance
   */
  getQueue(): Queue.Queue<MessageJobData> {
    return this.queue;
  }
} 