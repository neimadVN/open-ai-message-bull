# OpenAI Assistant Message Queue Manager

## Problem Statement

When working with OpenAI's [Assistants API](https://platform.openai.com/docs/assistants/how-it-works), developers face a significant limitation:

**You can only have one active Run in a Thread at any time.**

This creates several challenges:

1. **Message Batching Problem** - If users send multiple messages in quick succession, each message would require a separate Run, but we can't start a new Run until the previous one completes.

2. **Data Loss Risk** - Without proper queueing, newer messages might be lost if they arrive while a Run is in progress.

3. **API Inefficiency** - Processing each message individually is inefficient, especially given OpenAI's API rate limits and latency.

4. **User Experience Issues** - Users expect their messages to be processed in order and without data loss.

## Solution

This repository provides an optimized solution using Bull and Redis to address these challenges:

### Key Features

- **Message Batching** - Groups messages arriving within configurable time windows to be processed together in a single Run.
- **Thread Locking** - Uses Redis locks to ensure only one worker processes a Thread at a time.
- **Race Condition Prevention** - Carefully manages concurrent jobs to prevent data loss.
- **Automatic New Message Detection** - Detects and processes new messages that arrived during processing.
- **Optimized for Scalability** - Works well in environments with multiple workers.
- **Function Calling Support** - Handles OpenAI's function calling capability with a simple interface.
- **Framework Integration** - Includes adapters for NestJS to easily integrate with your existing applications.

### How It Works

1. Messages are added to a Bull queue with a configurable delay (default 10s)
2. Workers process the oldest unprocessed message from each Thread
3. When processing starts, all messages for that Thread are batched together
4. A Redis lock prevents concurrent processing of the same Thread
5. After processing completes, the system checks for newer messages and processes them immediately

## Getting Started

Check out the [example](./example) directory for implementation examples or the [documentation](./src/README.md) for detailed usage instructions.

## Installation

```bash
npm install openai-assistant-message-bull
```

## Basic Usage

```typescript
import { AssistantMessageQueue } from 'openai-assistant-message-bull';

// Initialize the queue manager
const assistantQueue = new AssistantMessageQueue({
  redisUrl: 'redis://localhost:6379',
  openAIApiKey: 'your-openai-api-key',
  assistantId: 'your-assistant-id',
});

// Add a message to a thread
await assistantQueue.addMessageToThread('thread-123', 'Hello, assistant!');

// Start the worker to process messages
assistantQueue.startWorker();
```

## Function Calling Support

You can handle function calls from OpenAI by providing a `handleRequiresAction` callback:

```typescript
const assistantQueue = new AssistantMessageQueue({
  // ...other options
  handleRequiresAction: async (threadId, runId, toolCalls) => {
    // Process each function call
    return Promise.all(toolCalls.map(async (toolCall) => {
      const args = JSON.parse(toolCall.function.arguments);
      
      // Handle the function
      let result;
      switch (toolCall.function.name) {
        case 'get_weather':
          result = await getWeatherData(args.location);
          break;
        default:
          result = { error: 'Unknown function' };
      }
      
      // Return the result
      return {
        tool_call_id: toolCall.id,
        output: JSON.stringify(result)
      };
    }));
  }
});
```

## NestJS Integration

This library includes a NestJS adapter that makes it easy to use in your NestJS applications:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssistantMessageQueueService } from 'openai-assistant-message-bull';

@Module({
  imports: [ConfigModule.forRoot()],
  providers: [
    {
      provide: AssistantMessageQueueService,
      useFactory: (configService: ConfigService) => {
        return new AssistantMessageQueueService({
          redisUrl: configService.get<string>('REDIS_URL'),
          openAIApiKey: configService.get<string>('OPENAI_API_KEY'),
          assistantId: configService.get<string>('OPENAI_ASSISTANT_ID'),
        });
      },
      inject: [ConfigService]
    }
  ],
  exports: [AssistantMessageQueueService]
})
export class AssistantMessageQueueModule {}
```

Then you can inject and use it in your services and controllers:

```typescript
import { Injectable } from '@nestjs/common';
import { AssistantMessageQueueService } from 'openai-assistant-message-bull';

@Injectable()
export class ChatService {
  constructor(private readonly assistantService: AssistantMessageQueueService) {}
  
  async sendMessage(threadId: string, message: string) {
    return this.assistantService.addMessageToThread(threadId, message);
  }
}
```

See the [NestJS example](./example/nestjs-example-module.ts) for a complete example.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 