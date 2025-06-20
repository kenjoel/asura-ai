import * as vscode from 'vscode';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, CancelTokenSource } from 'axios';
import { BaseApiProvider, ApiProviderConfig, ApiRequestOptions, ApiResponse, ModelCapability } from './base-provider';
import { SecurityService } from '../../security';

// Anthropic specific types
interface AnthropicChatRequest {
  model: string;
  messages: AnthropicChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  system?: string;
}

interface AnthropicChatMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicMessageContent[];
}

interface AnthropicMessageContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicChatResponse {
  id: string;
  type: string;
  model: string;
  role: string;
  content: AnthropicMessageContent[];
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamChunk {
  type: string;
  message?: {
    id: string;
    type: string;
    role: string;
    content: AnthropicMessageContent[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  delta?: {
    type: string;
    text?: string;
  };
  index: number;
}

// Anthropic API provider implementation
export class AnthropicProvider extends BaseApiProvider {
  private client: AxiosInstance;
  private cancelTokenSource?: CancelTokenSource;
  
  constructor(
    config: ApiProviderConfig,
    securityService: SecurityService
  ) {
    super(config, securityService);
    
    // Create Axios client
    this.client = axios.create({
      baseURL: this.config.apiEndpoint || 'https://api.anthropic.com',
      timeout: this.config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': this.config.apiVersion || '2023-06-01'
      }
    });
    
    // Add request interceptor for authentication
    this.client.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers['x-api-key'] = this.apiKey;
      }
      return config;
    });
  }
  
  /**
   * Sends a completion request to the Anthropic API
   * Note: Anthropic doesn't support traditional completions, so we adapt the chat interface
   * @param prompt The prompt to complete
   * @param options The request options
   */
  public async completion(prompt: string, options: ApiRequestOptions): Promise<ApiResponse> {
    // Convert to chat format
    const messages: AnthropicChatMessage[] = [
      { role: 'user', content: prompt }
    ];
    
    return this.chat(messages, options);
  }
  
  /**
   * Sends a chat completion request to the Anthropic API
   * @param messages The chat messages
   * @param options The request options
   */
  public async chat(messages: any[], options: ApiRequestOptions): Promise<ApiResponse> {
    try {
      // Validate model
      const modelConfig = this.getModel(options.model);
      
      if (!modelConfig) {
        throw new Error(`Model ${options.model} not found or not enabled`);
      }
      
      if (!modelConfig.capabilities.includes(ModelCapability.CHAT)) {
        throw new Error(`Model ${options.model} does not support chat`);
      }
      
      // Extract system message if present
      let systemMessage: string | undefined;
      const chatMessages: AnthropicChatMessage[] = [];
      
      for (const message of messages) {
        if (message.role === 'system') {
          systemMessage = message.content;
        } else if (message.role === 'user' || message.role === 'assistant') {
          chatMessages.push(message as AnthropicChatMessage);
        }
      }
      
      // Estimate token usage
      const estimatedPromptTokens = Math.ceil(
        messages.reduce((acc, msg) => acc + (typeof msg.content === 'string' ? msg.content.length : 0), 0) / 4
      );
      const estimatedMaxTokens = options.maxTokens || modelConfig.maxTokens;
      const estimatedTotalTokens = estimatedPromptTokens + estimatedMaxTokens;
      
      // Check rate limits
      const rateLimitCheck = this.checkRateLimit(estimatedTotalTokens);
      
      if (!rateLimitCheck.allowed) {
        const error = new Error(`Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter} seconds.`);
        error['code'] = 'rate_limit_exceeded';
        error['type'] = 'rate_limit';
        error['retryAfter'] = rateLimitCheck.retryAfter;
        throw error;
      }
      
      // Prepare request
      const request: AnthropicChatRequest = {
        model: options.model,
        messages: chatMessages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        stop_sequences: options.stop,
        system: systemMessage
      };
      
      // Create cancel token
      this.cancelTokenSource = axios.CancelToken.source();
      
      // Send request
      const response = await this.client.post<AnthropicChatResponse>(
        '/v1/messages',
        request,
        {
          cancelToken: this.cancelTokenSource.token,
          timeout: options.timeout || this.config.timeout
        }
      );
      
      // Extract text content
      let content = '';
      for (const contentItem of response.data.content) {
        if (contentItem.type === 'text') {
          content += contentItem.text || '';
        }
      }
      
      // Update rate limit counters
      const totalTokens = response.data.usage.input_tokens + response.data.usage.output_tokens;
      this.updateRateLimitCounters(totalTokens);
      
      // Transform response
      return {
        id: response.data.id,
        model: response.data.model,
        content,
        usage: {
          promptTokens: response.data.usage.input_tokens,
          completionTokens: response.data.usage.output_tokens,
          totalTokens: totalTokens
        },
        finishReason: response.data.stop_reason,
        created: Date.now() / 1000 // Anthropic doesn't provide a creation timestamp
      };
    } catch (error) {
      console.error('Anthropic chat error:', error);
      
      if (axios.isCancel(error)) {
        const cancelError = new Error('Request was cancelled');
        cancelError['code'] = 'request_cancelled';
        cancelError['type'] = 'unknown';
        throw cancelError;
      }
      
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        
        if (status === 429) {
          const rateLimitError = new Error(data?.error?.message || 'Rate limit exceeded');
          rateLimitError['code'] = 'rate_limit_exceeded';
          rateLimitError['type'] = 'rate_limit';
          rateLimitError['retryAfter'] = parseInt(error.response?.headers['retry-after'] || '60');
          throw rateLimitError;
        } else if (status === 401) {
          const authError = new Error(data?.error?.message || 'Invalid API key');
          authError['code'] = 'invalid_api_key';
          authError['type'] = 'authentication';
          throw authError;
        } else if (status === 400) {
          const requestError = new Error(data?.error?.message || 'Invalid request');
          requestError['code'] = 'invalid_request';
          requestError['type'] = 'invalid_request';
          throw requestError;
        } else if (status && status >= 500) {
          const serverError = new Error(data?.error?.message || 'Anthropic server error');
          serverError['code'] = 'server_error';
          serverError['type'] = 'server_error';
          throw serverError;
        } else if (error.code === 'ECONNABORTED') {
          const timeoutError = new Error('Request timed out');
          timeoutError['code'] = 'timeout';
          timeoutError['type'] = 'timeout';
          throw timeoutError;
        }
      }
      
      const unknownError = new Error(error instanceof Error ? error.message : String(error));
      unknownError['code'] = 'unknown_error';
      unknownError['type'] = 'unknown';
      throw unknownError;
    } finally {
      this.cancelTokenSource = undefined;
    }
  }
  
  /**
   * Sends a streaming chat completion request to the Anthropic API
   * @param messages The chat messages
   * @param options The request options
   * @param callback The callback to receive chunks of the response
   */
  public async streamingChat(
    messages: any[],
    options: ApiRequestOptions,
    callback: (chunk: string, done: boolean) => void
  ): Promise<ApiResponse> {
    try {
      // Validate model
      const modelConfig = this.getModel(options.model);
      
      if (!modelConfig) {
        throw new Error(`Model ${options.model} not found or not enabled`);
      }
      
      if (!modelConfig.capabilities.includes(ModelCapability.CHAT)) {
        throw new Error(`Model ${options.model} does not support chat`);
      }
      
      // Extract system message if present
      let systemMessage: string | undefined;
      const chatMessages: AnthropicChatMessage[] = [];
      
      for (const message of messages) {
        if (message.role === 'system') {
          systemMessage = message.content;
        } else if (message.role === 'user' || message.role === 'assistant') {
          chatMessages.push(message as AnthropicChatMessage);
        }
      }
      
      // Estimate token usage
      const estimatedPromptTokens = Math.ceil(
        messages.reduce((acc, msg) => acc + (typeof msg.content === 'string' ? msg.content.length : 0), 0) / 4
      );
      const estimatedMaxTokens = options.maxTokens || modelConfig.maxTokens;
      const estimatedTotalTokens = estimatedPromptTokens + estimatedMaxTokens;
      
      // Check rate limits
      const rateLimitCheck = this.checkRateLimit(estimatedTotalTokens);
      
      if (!rateLimitCheck.allowed) {
        const error = new Error(`Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter} seconds.`);
        error['code'] = 'rate_limit_exceeded';
        error['type'] = 'rate_limit';
        error['retryAfter'] = rateLimitCheck.retryAfter;
        throw error;
      }
      
      // Prepare request
      const request: AnthropicChatRequest = {
        model: options.model,
        messages: chatMessages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        stop_sequences: options.stop,
        system: systemMessage,
        stream: true
      };
      
      // Create cancel token
      this.cancelTokenSource = axios.CancelToken.source();
      
      // Send request
      const response = await this.client.post<NodeJS.ReadableStream>(
        '/v1/messages',
        request,
        {
          cancelToken: this.cancelTokenSource.token,
          timeout: options.timeout || this.config.timeout,
          responseType: 'stream',
          headers: {
            'Accept': 'text/event-stream'
          }
        }
      );
      
      // Process streaming response
      let fullContent = '';
      let responseId = '';
      let responseModel = '';
      let finishReason = '';
      let inputTokens = 0;
      let outputTokens = 0;
      
      const stream = response.data;
      
      return new Promise<ApiResponse>((resolve, reject) => {
        let buffer = '';
        
        stream.on('data', (chunk: Buffer) => {
          try {
            const chunkStr = chunk.toString();
            buffer += chunkStr;
            
            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (line.trim() === '' || line.trim() === 'data: ') {
                continue;
              }
              if (line.trim() === 'data: [DONE]') {
                callback('', true);
                continue;
              }
              
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                const data = JSON.parse(jsonStr) as AnthropicStreamChunk;
                
                if (data.type === 'message_start') {
                  if (data.message) {
                    responseId = data.message.id;
                    responseModel = data.message.model;
                  }
                } else if (data.type === 'content_block_start') {
                  // Content block start, nothing to do
                } else if (data.type === 'content_block_delta') {
                  if (data.delta && data.delta.type === 'text' && data.delta.text) {
                    fullContent += data.delta.text;
                    callback(data.delta.text, false);
                  }
                } else if (data.type === 'message_delta') {
                  // Message delta, check for stop reason
                  if (data.delta && 'stop_reason' in data.delta) {
                    finishReason = data.delta.stop_reason as string;
                  }
                } else if (data.type === 'message_stop') {
                  if (data.message && data.message.usage) {
                    inputTokens = data.message.usage.input_tokens;
                    outputTokens = data.message.usage.output_tokens;
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error processing stream chunk:', error);
            const streamError = new Error(error instanceof Error ? error.message : String(error));
            streamError['code'] = 'stream_processing_error';
            streamError['type'] = 'unknown';
            reject(streamError);
          }
        });
        
        stream.on('end', () => {
          // Process any remaining data in buffer
          if (buffer.trim() !== '' && buffer.trim() !== 'data: ' && buffer.trim() !== 'data: [DONE]') {
            try {
              if (buffer.startsWith('data: ')) {
                const jsonStr = buffer.slice(6);
                const data = JSON.parse(jsonStr) as AnthropicStreamChunk;
                
                if (data.type === 'content_block_delta' && data.delta && data.delta.type === 'text' && data.delta.text) {
                  fullContent += data.delta.text;
                  callback(data.delta.text, false);
                } else if (data.type === 'message_delta' && data.delta && 'stop_reason' in data.delta) {
                  finishReason = data.delta.stop_reason as string;
                } else if (data.type === 'message_stop' && data.message && data.message.usage) {
                  inputTokens = data.message.usage.input_tokens;
                  outputTokens = data.message.usage.output_tokens;
                }
              }
            } catch (error) {
              console.error('Error processing final stream chunk:', error);
            }
          }
          
          // Signal completion
          callback('', true);
          
          // If we didn't get token counts from the API, estimate them
          if (inputTokens === 0) {
            inputTokens = estimatedPromptTokens;
          }
          
          if (outputTokens === 0) {
            outputTokens = Math.ceil(fullContent.length / 4);
          }
          
          const totalTokens = inputTokens + outputTokens;
          
          // Update rate limit counters
          this.updateRateLimitCounters(totalTokens);
          
          // Resolve with final response
          resolve({
            id: responseId,
            model: responseModel,
            content: fullContent,
            usage: {
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              totalTokens
            },
            finishReason,
            created: Date.now() / 1000 // Anthropic doesn't provide a creation timestamp
          });
        });
        
        stream.on('error', (error) => {
          console.error('Stream error:', error);
          const streamError = new Error(error instanceof Error ? error.message : String(error));
          streamError['code'] = 'stream_error';
          streamError['type'] = 'unknown';
          reject(streamError);
        });
      });
    } catch (error) {
      console.error('Anthropic streaming chat error:', error);
      
      if (axios.isCancel(error)) {
        const cancelError = new Error('Request was cancelled');
        cancelError['code'] = 'request_cancelled';
        cancelError['type'] = 'unknown';
        throw cancelError;
      }
      
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        
        if (status === 429) {
          const rateLimitError = new Error(data?.error?.message || 'Rate limit exceeded');
          rateLimitError['code'] = 'rate_limit_exceeded';
          rateLimitError['type'] = 'rate_limit';
          rateLimitError['retryAfter'] = parseInt(error.response?.headers['retry-after'] || '60');
          throw rateLimitError;
        } else if (status === 401) {
          const authError = new Error(data?.error?.message || 'Invalid API key');
          authError['code'] = 'invalid_api_key';
          authError['type'] = 'authentication';
          throw authError;
        } else if (status === 400) {
          const requestError = new Error(data?.error?.message || 'Invalid request');
          requestError['code'] = 'invalid_request';
          requestError['type'] = 'invalid_request';
          throw requestError;
        } else if (status && status >= 500) {
          const serverError = new Error(data?.error?.message || 'Anthropic server error');
          serverError['code'] = 'server_error';
          serverError['type'] = 'server_error';
          throw serverError;
        } else if (error.code === 'ECONNABORTED') {
          const timeoutError = new Error('Request timed out');
          timeoutError['code'] = 'timeout';
          timeoutError['type'] = 'timeout';
          throw timeoutError;
        }
      }
      
      const unknownError = new Error(error instanceof Error ? error.message : String(error));
      unknownError['code'] = 'unknown_error';
      unknownError['type'] = 'unknown';
      throw unknownError;
    } finally {
      this.cancelTokenSource = undefined;
    }
  }
  
  /**
   * Generates embeddings for a text
   * Note: Anthropic doesn't currently provide an embeddings API, so this is a placeholder
   * @param _text The text to generate embeddings for
   * @param _options The request options
   */
  public async embeddings(_text: string, _options: ApiRequestOptions): Promise<number[]> {
    throw new Error('Embeddings are not supported by Anthropic API');
  }
  
  /**
   * Cancels an ongoing request
   */
  public cancelRequest(): void {
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel('Request cancelled by user');
      this.cancelTokenSource = undefined;
    }
  }
}
