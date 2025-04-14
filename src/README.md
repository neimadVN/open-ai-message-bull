# OpenAI Assistant Message Queue

This module provides a robust solution for managing message queues for OpenAI's Assistant API. It handles batching messages, prevents data loss, and ensures efficient processing of messages.

## Installation

```bash
npm install openai-assistant-message-bull
```

## Prerequisites

- Node.js 16.x or higher
- Redis server (local or remote)
- OpenAI API key
- OpenAI Assistant ID (you need to create an assistant first)

## Architecture

The main components are:

1. **AssistantMessageQueue**: The main class that manages the queue and worker.
2. **Bull Queue**: Handles job queuing, retries, and scheduling.
3. **Redis**: Used for storage and thread locking.
4. **OpenAI API**: Processes messages and runs.

## Usage

### Basic Usage

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

// When shutting down
await assistantQueue.close();
```

### Configuration Options

The `AssistantMessageQueue` constructor accepts various options:

```typescript
const assistantQueue = new AssistantMessageQueue({
  // Required options
  redisUrl: 'redis://localhost:6379',
  openAIApiKey: 'your-openai-api-key',
  assistantId: 'your-assistant-id',
  
  // Optional configuration with defaults
  queuePrefix: 'assistant',     // Prefix for queue names
  messageDelay: 10000,          // Delay before processing (ms)
  maxAttempts: 3,               // Maximum retry attempts
  backoff: {                    // Backoff strategy for retries
    type: 'exponential',
    delay: 5000
  },
  concurrency: 5,               // Maximum concurrent jobs
  defaultInstructions: 'Reply to all messages logically.',
  lockDuration: 300000,         // Thread lock duration (ms)
  removeOnComplete: true,       // Remove completed jobs
  
  // Function calling support
  handleRequiresAction: async (threadId, runId, toolCalls) => {
    // Handle tool calls and return outputs
    return [];
  }
});
```

### Getting Queue Status

You can monitor the status of the queue:

```typescript
const status = await assistantQueue.getQueueStatus();
console.log(status);
// {
//   activeCount: 1,
//   waitingCount: 5,
//   delayedCount: 3,
//   completedCount: 10,
//   failedCount: 0
// }
```

### Function Calling Support

To handle OpenAI function calls:

```typescript
const assistantQueue = new AssistantMessageQueue({
  // ...other options
  handleRequiresAction: async (threadId, runId, toolCalls) => {
    return Promise.all(toolCalls.map(async (toolCall) => {
      const args = JSON.parse(toolCall.function.arguments);
      let result;
      
      // Handle different functions
      switch (toolCall.function.name) {
        case 'get_weather':
          result = await getWeatherData(args.location);
          break;
        default:
          result = { error: 'Unknown function' };
      }
      
      return {
        tool_call_id: toolCall.id,
        output: JSON.stringify(result)
      };
    }));
  }
});
```

## Framework Integration

See the [examples](../example) directory for integration with NestJS and Express. 