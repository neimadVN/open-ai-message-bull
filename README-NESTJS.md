# OpenAI Assistant Message Queue for NestJS

This guide shows how to integrate the OpenAI Assistant Message Queue into a NestJS application.

## Installation

```bash
npm install openai-assistant-message-bull
```

## Basic Usage

### Using forRoot() method

The simplest way to use the AssistantMessageQueue in a NestJS application is with the `forRoot()` method:

```typescript
import { Module } from '@nestjs/common';
import { AssistantMessageQueueModule } from 'openai-assistant-message-bull';

@Module({
  imports: [
    AssistantMessageQueueModule.forRoot({
      redisUrl: 'redis://localhost:6379',
      openAIApiKey: process.env.OPENAI_API_KEY,
      assistantId: process.env.OPENAI_ASSISTANT_ID,
    }),
  ],
})
export class AppModule {}
```

### Using forRootAsync() with ConfigService

For more flexibility, you can use the `forRootAsync()` method with NestJS ConfigService:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssistantMessageQueueModule } from 'openai-assistant-message-bull';

@Module({
  imports: [
    ConfigModule.forRoot(),
    AssistantMessageQueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redisUrl: configService.get('REDIS_URL'),
        openAIApiKey: configService.get('OPENAI_API_KEY'),
        assistantId: configService.get('OPENAI_ASSISTANT_ID'),
      }),
    }),
  ],
})
export class AppModule {}
```

## Using in a Service

Once the module is imported, you can inject the `AssistantMessageQueueService` into your services:

```typescript
import { Injectable } from '@nestjs/common';
import { AssistantMessageQueueService } from 'openai-assistant-message-bull';

@Injectable()
export class ChatService {
  constructor(private readonly assistantQueue: AssistantMessageQueueService) {}

  async createThread() {
    return this.assistantQueue.createThread();
  }

  async sendMessage(threadId: string, message: string) {
    return this.assistantQueue.addMessageToThread(threadId, message);
  }

  async getMessages(threadId: string) {
    return this.assistantQueue.listMessages(threadId);
  }
}
```

## Advanced Usage with Handlers

### Function Calling

You can configure function calling by providing a `handleRequiresAction` handler:

```typescript
import { Module } from '@nestjs/common';
import { AssistantMessageQueueModule } from 'openai-assistant-message-bull';

@Module({
  imports: [
    AssistantMessageQueueModule.forRoot({
      redisUrl: 'redis://localhost:6379',
      openAIApiKey: process.env.OPENAI_API_KEY,
      assistantId: process.env.OPENAI_ASSISTANT_ID,
      handleRequiresAction: async (threadId, runId, toolCalls) => {
        // Process function calls
        const outputs = [];
        
        for (const toolCall of toolCalls) {
          if (toolCall.function.name === 'get_weather') {
            const args = JSON.parse(toolCall.function.arguments);
            const weather = await getWeatherData(args.location);
            
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(weather)
            });
          }
        }
        
        return outputs;
      }
    }),
  ],
})
export class AppModule {}
```

### Run Completion Handling

You can also react to completed runs by providing a `handleRunCompleted` handler:

```typescript
import { Module } from '@nestjs/common';
import { AssistantMessageQueueModule } from 'openai-assistant-message-bull';

@Module({
  imports: [
    AssistantMessageQueueModule.forRoot({
      redisUrl: 'redis://localhost:6379',
      openAIApiKey: process.env.OPENAI_API_KEY,
      assistantId: process.env.OPENAI_ASSISTANT_ID,
      handleRunCompleted: async (threadId, runId, result) => {
        // This will be called when a run completes successfully
        console.log(`Run ${runId} completed for thread ${threadId}`);
        console.log(`Processed ${result.messagesProcessed} messages`);
        
        // You could send notifications, update database, etc.
        await notifyUser(threadId);
        await updateChatStatus(threadId, 'completed');
      }
    }),
  ],
})
export class AppModule {}
```

## Full Example with Event Handling

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssistantMessageQueueModule } from 'openai-assistant-message-bull';
import { DatabaseModule } from './database/database.module';
import { NotificationService } from './notification/notification.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DatabaseModule,
    AssistantMessageQueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, NotificationService],
      useFactory: (
        configService: ConfigService,
        notificationService: NotificationService
      ) => ({
        redisUrl: configService.get('REDIS_URL'),
        openAIApiKey: configService.get('OPENAI_API_KEY'),
        assistantId: configService.get('OPENAI_ASSISTANT_ID'),
        messageDelay: 5000, // 5 seconds
        concurrency: 10,
        handleRequiresAction: async (threadId, runId, toolCalls) => {
          // Process function calls
          const outputs = [];
          
          for (const toolCall of toolCalls) {
            // Handle different function calls
            const handler = getFunctionHandler(toolCall.function.name);
            const result = await handler(JSON.parse(toolCall.function.arguments));
            
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(result)
            });
          }
          
          return outputs;
        },
        handleRunCompleted: async (threadId, runId, result) => {
          // Update chat status in database
          await updateChatStatus(threadId, 'completed');
          
          // Send notification to user
          await notificationService.sendCompletionNotification(threadId);
          
          // Log analytics
          await logChatCompletion(threadId, runId, result);
        }
      }),
    }),
  ],
})
export class AppModule {}
```

## Environment Variables

Make sure to set these environment variables:

```
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=your-openai-api-key
OPENAI_ASSISTANT_ID=your-assistant-id
``` 