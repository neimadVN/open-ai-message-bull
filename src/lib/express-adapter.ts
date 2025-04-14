import express, { Router, Request, Response, NextFunction, json } from 'express';
import { AssistantMessageQueue } from './assistant-message-queue';
import { RunRequiresActionEvent } from '../types/events';
import { ToolOutput } from '../types';

/**
 * Options for configuring the Express adapter
 */
export interface ExpressAdapterOptions {
  // AssistantMessageQueue options
  redisUrl: string;
  openAIApiKey: string;
  assistantId: string;
  
  // Express specific options
  basePath?: string;
  errorHandler?: (error: unknown, req: Request, res: Response, next: NextFunction) => void;
  
  // Optional function to handle requires_action runs
  handleRequiresAction?: (event: RunRequiresActionEvent) => Promise<void>;
}

/**
 * Interface for function handlers
 */
export type FunctionHandler = (args: any) => Promise<any>;
export type FunctionHandlers = Record<string, FunctionHandler>;

/**
 * Create a function to handle requires_action events from the assistant
 * This makes it easy to implement the tool calling functionality
 * 
 * @param handlers Object mapping function names to handler functions
 * @returns A function that can be passed to createAssistantRouter
 */
export function createFunctionCallHandler(handlers: FunctionHandlers) {
  return async (event: RunRequiresActionEvent): Promise<void> => {
    const { queue, runId, threadId, requiredAction } = event;
    
    if (requiredAction.type === 'submit_tool_outputs') {
      const toolOutputs = await Promise.all(
        requiredAction.submit_tool_outputs.tool_calls.map(async (toolCall: any) => {
          try {
            const { id, function: func } = toolCall;
            const handler = handlers[func.name];
            
            if (!handler) {
              throw new Error(`No handler found for function: ${func.name}`);
            }
            
            const args = JSON.parse(func.arguments);
            const output = await handler(args);
            
            return {
              tool_call_id: id,
              output: JSON.stringify(output)
            };
          } catch (error) {
            console.error('Error processing function call:', error);
            return {
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: String(error) })
            };
          }
        })
      );
      
      await queue.submitToolOutputs(threadId, runId, toolOutputs);
    }
  };
}

/**
 * Create an Express router for handling assistant API requests
 * 
 * @param options Configuration options for the router
 * @returns An Express router and the AssistantMessageQueue instance
 */
export function createAssistantRouter(options: ExpressAdapterOptions) {
  const {
    redisUrl,
    openAIApiKey,
    assistantId,
    basePath = '',
    errorHandler = defaultErrorHandler,
    handleRequiresAction
  } = options;
  
  // Create the queue
  const assistantQueue = new AssistantMessageQueue({
    redisUrl,
    openAIApiKey,
    assistantId
  });
  
  // If requires_action handler is provided, register it
  if (handleRequiresAction) {
    // We'll need to implement event handling in the AssistantMessageQueue
    // For now this is a placeholder for the event-based approach
    // assistantQueue.on('run.requires_action', handleRequiresAction);
  }
  
  // Create the router
  const router = Router();
  router.use(json());
  
  // Thread management
  router.post(`${basePath}/threads`, async (req, res, next) => {
    try {
      const metadata = req.body.metadata || {};
      const threadId = await assistantQueue.createThread(metadata);
      res.status(201).json({ threadId });
    } catch (error) {
      next(error);
    }
  });
  
  router.get(`${basePath}/threads/:threadId`, async (req, res, next) => {
    try {
      const { threadId } = req.params;
      const thread = await assistantQueue.getThread(threadId);
      res.json(thread);
    } catch (error) {
      next(error);
    }
  });
  
  // Message management
  router.post(`${basePath}/threads/:threadId/messages`, async (req, res, next) => {
    try {
      const { threadId } = req.params;
      const { message, metadata = {} } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Message content is required' });
      }
      
      const messageResponse = await assistantQueue.createMessage(threadId, message);
      res.status(201).json({ messageId: messageResponse.id });
    } catch (error) {
      next(error);
    }
  });
  
  router.get(`${basePath}/threads/:threadId/messages`, async (req, res, next) => {
    try {
      const { threadId } = req.params;
      const { limit, order, after, before } = req.query;
      
      const messages = await assistantQueue.listMessages(threadId, {
        limit: limit ? parseInt(limit as string, 10) : undefined,
        order: (order as 'asc' | 'desc') || undefined,
        after: after as string || undefined,
        before: before as string || undefined
      });
      
      // Transform OpenAI message format to a more API-friendly format
      const transformedMessages = messages.data.map((message: any) => ({
        id: message.id,
        role: message.role,
        content: message.content[0]?.text?.value || '',
        createdAt: message.created_at
      }));
      
      res.json({
        data: transformedMessages,
        hasMore: messages.has_more || false
      });
    } catch (error) {
      next(error);
    }
  });
  
  // Run management
  router.post(`${basePath}/threads/:threadId/runs`, async (req, res, next) => {
    try {
      const { threadId } = req.params;
      const { instructions } = req.body;
      
      const runResponse = await assistantQueue.createRun(threadId, { instructions });
      res.status(201).json({ runId: runResponse.id });
    } catch (error) {
      next(error);
    }
  });
  
  router.post(`${basePath}/threads/:threadId/runs/:runId/cancel`, async (req, res, next) => {
    try {
      const { threadId, runId } = req.params;
      
      await assistantQueue.cancelRun(threadId, runId);
      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  });
  
  router.post(`${basePath}/threads/:threadId/runs/:runId/tool-outputs`, async (req, res, next) => {
    try {
      const { threadId, runId } = req.params;
      const { toolOutputs } = req.body;
      
      if (!Array.isArray(toolOutputs)) {
        return res.status(400).json({ error: 'Tool outputs must be an array' });
      }
      
      await assistantQueue.submitToolOutputs(threadId, runId, toolOutputs);
      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  });
  
  // Queue status
  router.get(`${basePath}/status`, async (req, res, next) => {
    try {
      const status = await assistantQueue.getQueueStatus();
      res.json(status);
    } catch (error) {
      next(error);
    }
  });
  
  // Register error handler
  router.use(`${basePath}/*`, errorHandler);
  
  return { router, assistantQueue };
}

/**
 * Default error handler for the Express adapter
 */
function defaultErrorHandler(error: unknown, req: Request, res: Response, next: NextFunction) {
  console.error('Express adapter error:', error);
  const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
  res.status(500).json({ error: errorMessage });
}

/**
 * Example usage:
 * 
 * ```typescript
 * import express from 'express';
 * import { createAssistantRouter, createFunctionCallHandler } from 'openai-assistant-message-bull';
 * 
 * const app = express();
 * app.use(express.json());
 * 
 * // Create function handlers
 * const functionHandlers = {
 *   get_weather: async ({ location }) => {
 *     // Fetch weather data
 *     return { temperature: '22°C', condition: 'Sunny', location };
 *   },
 *   get_user_info: async ({ userId }) => {
 *     // Fetch user data
 *     return { name: 'John Doe', email: 'john@example.com' };
 *   }
 * };
 * 
 * // Create the assistant router
 * const { router, assistantQueue } = createAssistantRouter({
 *   redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
 *   openAIApiKey: process.env.OPENAI_API_KEY || '',
 *   assistantId: process.env.OPENAI_ASSISTANT_ID || '',
 *   basePath: '/api/chat',
 *   handleRequiresAction: createFunctionCallHandler(functionHandlers)
 * });
 * 
 * // Add the router to the app
 * app.use(router);
 * 
 * // Start the server
 * app.listen(3000, () => {
 *   console.log('Server running on port 3000');
 * });
 * 
 * // Cleanup on exit
 * process.on('SIGTERM', async () => {
 *   await assistantQueue.close();
 *   process.exit(0);
 * });
 * ```
 */ 