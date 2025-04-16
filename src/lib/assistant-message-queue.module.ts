import { DynamicModule, Module } from '@nestjs/common';
import { AssistantMessageQueueService, assistantMessageQueueFactory } from './nestjs-adapter';
import { AssistantMessageQueueOptions } from '../types';

/**
 * NestJS module for the AssistantMessageQueue
 * Use the forRoot() method to configure and register the module
 */
@Module({})
export class AssistantMessageQueueModule {
  /**
   * Creates a dynamic module with the provided configuration
   * 
   * @param options AssistantMessageQueue configuration options
   * @returns A dynamic module that provides the AssistantMessageQueueService
   * 
   * @example
   * ```typescript
   * @Module({
   *   imports: [
   *     AssistantMessageQueueModule.forRoot({
   *       redisUrl: 'redis://localhost:6379',
   *       openAIApiKey: process.env.OPENAI_API_KEY,
   *       assistantId: process.env.OPENAI_ASSISTANT_ID,
   *       handleRequiresAction: async (threadId, runId, toolCalls) => {
   *         // Handle function calls
   *         return [];
   *       },
   *       handleRunCompleted: async (threadId, runId, result) => {
   *         // Handle completed runs
   *         console.log(`Run ${runId} completed for thread ${threadId}`);
   *       }
   *     })
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(options: AssistantMessageQueueOptions): DynamicModule {
    return {
      module: AssistantMessageQueueModule,
      providers: [assistantMessageQueueFactory(options)],
      exports: [AssistantMessageQueueService],
    };
  }

  /**
   * Creates a dynamic module with the provided factory function
   * This allows for asynchronous configuration
   * 
   * @param options Options for asynchronous module configuration
   * @returns A dynamic module that provides the AssistantMessageQueueService
   * 
   * @example
   * ```typescript
   * @Module({
   *   imports: [
   *     AssistantMessageQueueModule.forRootAsync({
   *       imports: [ConfigModule],
   *       inject: [ConfigService],
   *       useFactory: (configService: ConfigService) => ({
   *         redisUrl: configService.get('REDIS_URL'),
   *         openAIApiKey: configService.get('OPENAI_API_KEY'),
   *         assistantId: configService.get('OPENAI_ASSISTANT_ID'),
   *         handleRequiresAction: async (threadId, runId, toolCalls) => {
   *           // Handle function calls
   *           return [];
   *         },
   *         handleRunCompleted: async (threadId, runId, result) => {
   *           // Handle completed runs
   *           console.log(`Run ${runId} completed for thread ${threadId}`);
   *         }
   *       }),
   *     }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static forRootAsync(options: {
    imports?: any[];
    useFactory: (...args: any[]) => AssistantMessageQueueOptions | Promise<AssistantMessageQueueOptions>;
    inject?: any[];
  }): DynamicModule {
    return {
      module: AssistantMessageQueueModule,
      imports: options.imports || [],
      providers: [
        {
          provide: AssistantMessageQueueService,
          useFactory: async (...args: any[]) => {
            const config = await options.useFactory(...args);
            return new AssistantMessageQueueService(config);
          },
          inject: options.inject || [],
        },
      ],
      exports: [AssistantMessageQueueService],
    };
  }
} 