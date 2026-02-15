/**
 * ============================================================================
 * RESPONSES API STREAMING HANDLER
 * ============================================================================
 *
 * Handles streaming responses for the OpenAI Responses API format.
 * This is different from Chat Completions streaming - it uses different event types.
 *
 * Responses API Events:
 * - response.created
 * - response.output_item.added (for reasoning and message items only)
 * - response.output_text.delta
 * - response.reasoning.delta
 * - response.function_call_arguments.delta
 * - response.function_call_arguments.done
 * - response.completed
 *
 * IMPORTANT: Tool calls are NOT separate output items in the Responses API.
 * They are included in the message item's `tool_calls` array. Only reasoning
 * and message items get their own `output_item.added` events.
 *
 * @module handlers/responses-streaming
 */

import { generateUUID } from '../utils';

/**
 * ============================================================================
 * TYPES
 * ============================================================================
 */

interface ResponsesApiEvent {
  type: string;
  [key: string]: any;
}

/**
 * ============================================================================
 * STREAMING HANDLER
 * ============================================================================
 */

/**
 * Handle streaming for Responses API format.
 *
 * Transforms Cloudflare AI streaming responses to OpenAI Responses API SSE format.
 * This format is different from Chat Completions streaming.
 *
 * @param stream - Cloudflare AI streaming response
 * @param model - Model identifier
 * @returns Response with Responses API SSE events
 */
export async function handleResponsesApiStreaming(
  stream: ReadableStream,
  model: string
): Promise<Response> {
  console.log('[Responses] Processing Responses API streaming');

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const responseId = `resp_${generateUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const itemId = `msg_${generateUUID()}`;
  const reasoningItemId = `think_${generateUUID()}`;

  // Process stream in background
  (async () => {
    try {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let hasSeenFirstToken = false;
      let hasSeenFirstOutputItem = false;
      let hasSeenFirstReasoningItem = false;
      let reasoningBuffer = '';
      let contentBuffer = '';
      let toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let messageOutputIndex = 0; // Track the correct output index for message item

      // Send response.created event
      const createdEvent: ResponsesApiEvent = {
        type: 'response.created',
        response: {
          id: responseId,
          object: 'response',
          model,
          created_at: created,
          status: 'in_progress',
          output: []
        }
      };
      await writer.write(encoder.encode(`event: response.created\ndata: ${JSON.stringify(createdEvent)}\n\n`));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            // Parse Cloudflare chunk
            let parsed: any;

            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              parsed = JSON.parse(data);
            } else {
              parsed = JSON.parse(line);
            }


            // Extract content and reasoning
            let content = '';
            let reasoningContent = '';
            let toolCallsChunk: any[] | undefined;

            // Parse different formats
            if (parsed.response !== undefined) {
              content = parsed.response || '';
            } else if (parsed.choices && Array.isArray(parsed.choices) && parsed.choices[0]) {
              const choice = parsed.choices[0];
              if (choice.delta?.content) {
                content = choice.delta.content;
              }
              if (choice.delta?.reasoning_content) {
                reasoningContent = choice.delta.reasoning_content;
              }
              if (choice.delta?.tool_calls) {
                toolCallsChunk = choice.delta.tool_calls;
              }
            } else if (parsed.content !== undefined) {
              content = parsed.content || '';
            }

            if (parsed.reasoning_content) {
              reasoningContent = parsed.reasoning_content;
            }

            // Accumulate reasoning
            if (reasoningContent) {
              // Send reasoning item added event on first reasoning
              if (!hasSeenFirstReasoningItem) {
                hasSeenFirstReasoningItem = true;
                messageOutputIndex = 1; // Message will be at index 1 if we have reasoning

                const reasoningItemAddedEvent: ResponsesApiEvent = {
                  type: 'response.output_item.added',
                  output_index: 0,
                  item: {
                    id: reasoningItemId,
                    type: 'reasoning',
                    role: 'assistant',
                    status: 'in_progress'
                  }
                };
                await writer.write(encoder.encode(`event: response.output_item.added\ndata: ${JSON.stringify(reasoningItemAddedEvent)}\n\n`));
              }

              reasoningBuffer += reasoningContent;

              // Send reasoning delta event
              const reasoningDeltaEvent: ResponsesApiEvent = {
                type: 'response.reasoning.delta',
                item_id: reasoningItemId,
                delta: reasoningContent
              };
              await writer.write(encoder.encode(`event: response.reasoning.delta\ndata: ${JSON.stringify(reasoningDeltaEvent)}\n\n`));
            }

            // Accumulate content
            if (content) {
              contentBuffer += content;
            }

            // Send output_item.added on first content or first tool call
            if ((content || toolCallsChunk) && !hasSeenFirstOutputItem) {
              hasSeenFirstOutputItem = true;

              const itemAddedEvent: ResponsesApiEvent = {
                type: 'response.output_item.added',
                output_index: messageOutputIndex,
                item: {
                  id: itemId,
                  type: 'message',
                  role: 'assistant',
                  status: 'in_progress'
                }
              };
              await writer.write(encoder.encode(`event: response.output_item.added\ndata: ${JSON.stringify(itemAddedEvent)}\n\n`));
            }

            // Send content delta
            if (content) {
              const deltaEvent: ResponsesApiEvent = {
                type: 'response.output_text.delta',
                output_index: messageOutputIndex,
                content_index: 0,
                delta: content,
                item_id: itemId
              };
              await writer.write(encoder.encode(`event: response.output_text.delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`));
            }

            // Handle tool calls - stream them properly
            if (toolCallsChunk && toolCallsChunk.length > 0) {
              for (const tc of toolCallsChunk) {
                const index = tc.index || 0;

                // Get or create tool call entry
                if (!toolCalls.has(index)) {
                  const toolCallId = tc.id || `tc_${generateUUID()}`;
                  const functionName = tc.function?.name || '';

                  toolCalls.set(index, {
                    id: toolCallId,
                    name: functionName,
                    arguments: ''
                  });

                  // Note: We do NOT send output_item.added for tool calls
                  // Tool calls are part of the message item, not separate output items
                }

                // Stream function arguments delta
                const toolCall = toolCalls.get(index)!;
                const argsDelta = tc.function?.arguments || '';

                if (argsDelta) {
                  toolCall.arguments += argsDelta;

                  // Tool calls don't have separate output indices, but we still need to track
                  // which tool call this delta belongs to for the output_index field
                  const toolCallOutputIndex = messageOutputIndex + 1 + index;

                  const argsDeltaEvent: ResponsesApiEvent = {
                    type: 'response.function_call_arguments.delta',
                    item_id: toolCall.id,
                    output_index: toolCallOutputIndex,
                    call_id: toolCall.id,
                    delta: argsDelta
                  };
                  await writer.write(encoder.encode(`event: response.function_call_arguments.delta\ndata: ${JSON.stringify(argsDeltaEvent)}\n\n`));
                }
              }
            }

          } catch (e) {
            console.error('[Responses] Error parsing stream chunk:', e);
          }
        }
      }

      // Build output array with reasoning and message items
      const outputItems: any[] = [];

      // Add reasoning output item if we have reasoning content
      if (reasoningBuffer) {
        outputItems.push({
          id: reasoningItemId,
          type: 'reasoning',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'reasoning',
              text: reasoningBuffer
            }
          ]
        });
      }

      // Add message output item (always include, even if empty when there are tool calls)
      const messageItem: any = {
        id: itemId,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: contentBuffer || ' '
          }
        ]
      };

      // Add tool_calls array to message item if there are any tool calls
      if (toolCalls.size > 0) {
        messageItem.tool_calls = Array.from(toolCalls.values()).map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments
          }
        }));

        // Send function_call_arguments.done events for all tool calls
        for (const [index, tc] of Array.from(toolCalls.entries())) {
          const toolCallOutputIndex = messageOutputIndex + 1 + index;

          const argsDoneEvent: ResponsesApiEvent = {
            type: 'response.function_call_arguments.done',
            item_id: tc.id,
            output_index: toolCallOutputIndex,
            call_id: tc.id,
            arguments: tc.arguments
          };
          await writer.write(encoder.encode(`event: response.function_call_arguments.done\ndata: ${JSON.stringify(argsDoneEvent)}\n\n`));
        }
      }

      outputItems.push(messageItem);

      // Send response.completed event
      const completedEvent: ResponsesApiEvent = {
        type: 'response.completed',
        response: {
          id: responseId,
          object: 'response',
          model,
          created_at: created,
          status: 'completed',
          output: outputItems,
          ...(reasoningBuffer && {
            reasoning: {
              content: reasoningBuffer,
              summary: 'auto'
            }
          }),
          usage: {
            input_tokens: 0,
            output_tokens: Math.ceil((contentBuffer.length + reasoningBuffer.length) / 4),
            total_tokens: Math.ceil((contentBuffer.length + reasoningBuffer.length) / 4)
          }
        }
      };
      await writer.write(encoder.encode(`event: response.completed\ndata: ${JSON.stringify(completedEvent)}\n\n`));
      await writer.write(encoder.encode('event: done\ndata: [DONE]\n\n'));
      await writer.close();

      console.log('[Responses] Streaming completed successfully');

    } catch (error) {
      console.error('[Responses] Streaming error:', error);

      // Send error event
      try {
        const errorEvent = {
          type: 'error',
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            type: 'api_error'
          }
        };
        await writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`));
      } catch (e) {
        console.error('[Responses] Failed to send error event:', e);
      }

      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}



