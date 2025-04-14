import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AssistantMessageQueue } from './assistant-message-queue';
import { 
  AssistantMessageQueueOptions, 
  ToolCall, 
  ToolOutput, 
  ProcessingResult,
  QueueStatus 
} from '../types';

/**
 * NestJS adapter for the AssistantMessageQueue
 * This adapter makes it easy to use the AssistantMessageQueue in NestJS applications.
 */
@Injectable()
export class AssistantMessageQueueService implements OnModuleInit, OnModuleDestroy {
  private queue: AssistantMessageQueue;

  /**
   * Creates a new AssistantMessageQueueService
   * @param options Configuration options for the AssistantMessageQueue
   */
  constructor(private readonly options: AssistantMessageQueueOptions) {
    this.queue = new AssistantMessageQueue(options);
  }

  /**
   * Initializes the service when the module is initialized
   * Starts the worker automatically
   */
  onModuleInit(): void {
    this.queue.startWorker();
  }

  /**
   * Cleans up resources when the module is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  /**
   * Gets the underlying AssistantMessageQueue instance
   * @returns The AssistantMessageQueue instance
   */
  getQueue(): AssistantMessageQueue {
    return this.queue;
  }

  /**
   * Creates a new thread
   * @param metadata Optional metadata for the thread
   * @returns Created thread ID
   */
  async createThread(metadata?: Record<string, string>): Promise<string> {
    return this.queue.createThread(metadata);
  }

  /**
   * Retrieves a thread
   * @param threadId Thread ID
   * @returns Thread object
   */
  async getThread(threadId: string) {
    return this.queue.getThread(threadId);
  }

  /**
   * Creates a message in a thread
   * @param threadId Thread ID
   * @param content Message content
   * @returns Created message
   */
  async createMessage(threadId: string, content: string) {
    return this.queue.createMessage(threadId, content);
  }

  /**
   * Creates and starts a run for a thread
   * @param threadId Thread ID
   * @param options Run options
   * @returns Created run
   */
  async createRun(threadId: string, options?: {
    instructions?: string;
    tools?: any[];
    metadata?: Record<string, string>;
  }) {
    return this.queue.createRun(threadId, options);
  }

  /**
   * Cancels a run
   * @param threadId Thread ID
   * @param runId Run ID
   * @returns Cancelled run
   */
  async cancelRun(threadId: string, runId: string) {
    return this.queue.cancelRun(threadId, runId);
  }

  /**
   * Lists messages in a thread
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
    return this.queue.listMessages(threadId, options);
  }

  /**
   * Submit tool outputs for a run that requires action
   * @param threadId Thread ID
   * @param runId Run ID
   * @param toolOutputs Tool outputs
   * @returns Updated run
   */
  async submitToolOutputs(threadId: string, runId: string, toolOutputs: ToolOutput[]) {
    return this.queue.submitToolOutputs(threadId, runId, toolOutputs);
  }

  /**
   * Adds a message to a thread and queues it for processing
   * @param threadId Thread ID
   * @param message Message content
   * @param instructions Optional custom instructions
   * @returns Job ID
   */
  async addMessageToThread(threadId: string, message: string, instructions?: string): Promise<string> {
    return this.queue.addMessageToThread(threadId, message, instructions);
  }

  /**
   * Gets the current status of the queue
   * @returns Queue status information
   */
  async getQueueStatus(): Promise<QueueStatus> {
    return this.queue.getQueueStatus();
  }
}

/**
 * Factory function to create the AssistantMessageQueueService
 * This can be used in the NestJS module definition
 * @param options Configuration options
 * @returns Factory function
 */
export const assistantMessageQueueFactory = (options: AssistantMessageQueueOptions) => {
  return {
    provide: AssistantMessageQueueService,
    useFactory: () => {
      return new AssistantMessageQueueService(options);
    }
  };
};

/**
 * Example NestJS module configuration:
 * 
 * ```typescript
 * @Module({
 *   providers: [
 *     assistantMessageQueueFactory({
 *       redisUrl: 'redis://localhost:6379',
 *       openAIApiKey: process.env.OPENAI_API_KEY,
 *       assistantId: process.env.OPENAI_ASSISTANT_ID,
 *       handleRequiresAction: async (threadId, runId, toolCalls) => {
 *         // Handle function calls
 *         return [];
 *       }
 *     })
 *   ],
 *   exports: [AssistantMessageQueueService]
 * })
 * export class AssistantMessageQueueModule {}
 * ```
 */ 