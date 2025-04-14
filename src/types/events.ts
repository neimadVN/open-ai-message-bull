import { AssistantMessageQueue } from '../lib/assistant-message-queue';
import { ToolCall } from '../types';

/**
 * Event emitted when an assistant run requires action (tool calls)
 */
export interface RunRequiresActionEvent {
  /**
   * The AssistantMessageQueue instance that emitted the event
   */
  queue: AssistantMessageQueue;
  
  /**
   * The Thread ID
   */
  threadId: string;
  
  /**
   * The Run ID
   */
  runId: string;
  
  /**
   * The required action details
   */
  requiredAction: {
    /**
     * Type of required action (currently only 'submit_tool_outputs' is supported)
     */
    type: 'submit_tool_outputs';
    
    /**
     * Tool output submission details
     */
    submit_tool_outputs: {
      /**
       * Array of tool calls that need responses
       */
      tool_calls: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        }
      }>
    }
  };
} 