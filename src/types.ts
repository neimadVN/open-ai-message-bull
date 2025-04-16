/**
 * Configuration options for the AssistantMessageQueue
 */
export interface AssistantMessageQueueOptions {
  /**
   * Redis connection URL (e.g., 'redis://localhost:6379')
   */
  redisUrl: string;
  
  /**
   * OpenAI API Key
   */
  openAIApiKey: string;
  
  /**
   * Assistant ID from OpenAI
   */
  assistantId: string;
  
  /**
   * Queue name prefix (default: 'assistant')
   */
  queuePrefix?: string;
  
  /**
   * Delay before processing messages to allow for batching (in milliseconds)
   * Default: 10000 (10 seconds)
   */
  messageDelay?: number;
  
  /**
   * Number of job processing attempts before giving up
   * Default: 3
   */
  maxAttempts?: number;
  
  /**
   * Backoff configuration for failed jobs
   */
  backoff?: {
    /**
     * Type of backoff delay ('fixed' or 'exponential')
     * Default: 'exponential'
     */
    type?: 'fixed' | 'exponential';
    
    /**
     * Initial delay in milliseconds
     * Default: 5000 (5 seconds)
     */
    delay?: number;
  };
  
  /**
   * Maximum number of concurrent jobs a worker can process
   * Default: 5
   */
  concurrency?: number;
  
  /**
   * Default instructions for the assistant when processing messages
   */
  defaultInstructions?: string;
  
  /**
   * Lock duration for thread processing (in milliseconds)
   * Default: 300000 (5 minutes)
   */
  lockDuration?: number;
  
  /**
   * Whether to remove completed jobs from the queue
   * Default: true
   */
  removeOnComplete?: boolean;

  /**
   * Handler for requires_action status in OpenAI runs
   * This is called when a run requires function calling
   * @param threadId Thread ID
   * @param runId Run ID
   * @param toolCalls Tool calls from OpenAI
   * @returns Tool outputs to submit back to OpenAI
   */
  handleRequiresAction?: ((
    threadId: string, 
    runId: string, 
    toolCalls: ToolCall[]
  ) => Promise<ToolOutput[]>) | null;

  /**
   * Handler for completed runs
   * This is called when a run completes successfully
   * @param threadId Thread ID
   * @param runId Run ID
   * @param result Processing result
   */
  handleRunCompleted?: ((
    threadId: string,
    runId: string,
    result: ProcessingResult
  ) => Promise<void>) | null;
}

/**
 * Tool call from OpenAI
 */
export interface ToolCall {
  /**
   * ID of the tool call
   */
  id: string;

  /**
   * Type of the tool call
   */
  type: 'function';

  /**
   * Function call details
   */
  function: {
    /**
     * Name of the function
     */
    name: string;

    /**
     * Arguments for the function as a JSON string
     */
    arguments: string;
  };
}

/**
 * Tool output to submit to OpenAI
 */
export interface ToolOutput {
  /**
   * ID of the tool call
   */
  tool_call_id: string;

  /**
   * Output of the tool as a string
   */
  output: string;
}

/**
 * Internal message job data structure
 */
export interface MessageJobData {
  /**
   * Thread ID
   */
  threadId: string;
  
  /**
   * Message content
   */
  message: string;
  
  /**
   * Timestamp when the message was added
   */
  timestamp: number;
  
  /**
   * Optional instructions for this specific message batch
   */
  instructions?: string;
}

/**
 * Information about a processed job
 */
export interface ProcessedJob {
  /**
   * Job ID
   */
  id: string;
  
  /**
   * Thread ID
   */
  threadId: string;
  
  /**
   * Message content
   */
  message: string;
  
  /**
   * Timestamp when the message was added
   */
  timestamp: number;
}

/**
 * Result of processing messages
 */
export interface ProcessingResult {
  /**
   * Thread ID
   */
  threadId: string;
  
  /**
   * Number of messages processed
   */
  messagesProcessed: number;
  
  /**
   * Job IDs that were processed
   */
  processedJobIds: string[];
  
  /**
   * Run ID from OpenAI
   */
  runId: string;
  
  /**
   * Status of the run
   */
  status: string;
  
  /**
   * The assistant's response message(s)
   */
  assistantMessages?: Array<{
    id: string;
    content: any[];
    role: string;
    created_at: number;
  }>;
}

/**
 * Status of the assistant message queue
 */
export interface QueueStatus {
  /**
   * Number of active jobs
   */
  activeCount: number;
  
  /**
   * Number of waiting jobs
   */
  waitingCount: number;
  
  /**
   * Number of delayed jobs
   */
  delayedCount: number;
  
  /**
   * Number of completed jobs
   */
  completedCount: number;
  
  /**
   * Number of failed jobs
   */
  failedCount: number;
} 