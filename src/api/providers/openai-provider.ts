import * as vscode from 'vscode';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, CancelTokenSource } from 'axios';
import { BaseApiProvider, ApiProviderConfig, ApiRequestOptions, ApiResponse, ModelCapability } from './base-provider';
import { SecurityService } from '../../security';

// OpenAI specific types
interface OpenAICompletionRequest {
  model: string;
  prompt: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

interface OpenAIEmbeddingRequest {
  model: string;
  input: string;
}

interface OpenAICompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    text: string;
    index: number;
    logprobs: any;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: OpenAIChatMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: {
    object: string;
    embedding: number[];
    index: number;
  }[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    delta: {
      content?: string;
      role?: string;
    };
    index: number;
    finish_reason: string | null;
  }[];
}

// OpenAI API provider implementation
export class OpenAIProvider extends BaseApiProvider {
  private client: AxiosInstance;
  private cancelTokenSource?: CancelTokenSource;
  
  constructor(
    config: ApiProviderConfig,
    securityService: SecurityService
  ) {
    super(config, securityService);
    
    // Create Axios client
    this.client = axios.create({
      baseURL: this.config.apiEndpoint || 'https://api.openai.com/v1',
      timeout: this.config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Add request interceptor for authentication
    this.client.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      return config;
    });
  }
  
  /**
   * Sends a completion request to the OpenAI API
   * @param prompt The prompt to complete
   * @param options The request options
   */
  public async completion(prompt: string, options: ApiRequestOptions): Promise<ApiResponse> {
    try {
      // Validate model
      const modelConfig = this.getModel(options.model);
      
      if (!modelConfig) {
        throw new Error(`Model ${options.model} not found or not enabled`);
      }
      
      if (!modelConfig.capabilities.includes(ModelCapability.COMPLETION)) {
        throw new Error(`Model ${options.model} does not support completion`);
      }
      
      // Estimate token usage
      const estimatedPromptTokens = Math.ceil(prompt.length / 4); // Rough estimate
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
      const request: OpenAICompletionRequest = {
        model: options.model,
        prompt,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stop
      };
      
      // Create cancel token
      this.cancelTokenSource = axios.CancelToken.source();
      
      // Send request
      const response = await this.client.post<OpenAICompletionResponse>(
        '/completions',
        request,
        {
          cancelToken: this.cancelTokenSource.token,
          timeout: options.timeout || this.config.timeout
        }
      );
      
      // Update rate limit counters
      this.updateRateLimitCounters(response.data.usage.total_tokens);
      
      // Transform response
      return {
        id: response.data.id,
        model: response.data.model,
        content: response.data.choices[0].text,
        usage: {
          promptTokens: response.data.usage.prompt_tokens,
          completionTokens: response.data.usage.completion_tokens,
          totalTokens: response.data.usage.total_tokens
        },
        finishReason: response.data.choices[0].finish_reason,
        created: response.data.created
      };
    } catch (error) {
      console.error('OpenAI completion error:', error);
      
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
          const serverError = new Error(data?.error?.message || 'OpenAI server error');
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
   * Sends a chat completion request to the OpenAI API
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
      
      // Estimate token usage
      const estimatedPromptTokens = Math.ceil(
        messages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0) / 4
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
      const request: OpenAIChatRequest = {
        model: options.model,
        messages: messages as OpenAIChatMessage[],
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stop
      };
      
      // Create cancel token
      this.cancelTokenSource = axios.CancelToken.source();
      
      // Send request
      const response = await this.client.post<OpenAIChatResponse>(
        '/chat/completions',
        request,
        {
          cancelToken: this.cancelTokenSource.token,
          timeout: options.timeout || this.config.timeout
        }
      );
      
      // Update rate limit counters
      this.updateRateLimitCounters(response.data.usage.total_tokens);
      
      // Transform response
      return {
        id: response.data.id,
        model: response.data.model,
        content: response.data.choices[0].message.content,
        usage: {
          promptTokens: response.data.usage.prompt_tokens,
          completionTokens: response.data.usage.completion_tokens,
          totalTokens: response.data.usage.total_tokens
        },
        finishReason: response.data.choices[0].finish_reason,
        created: response.data.created
      };
    } catch (error) {
      console.error('OpenAI chat error:', error);
      
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
          const serverError = new Error(data?.error?.message || 'OpenAI server error');
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
   * Sends a streaming chat completion request to the OpenAI API
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
      
      // Estimate token usage
      const estimatedPromptTokens = Math.ceil(
        messages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0) / 4
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
      const request: OpenAIChatRequest = {
        model: options.model,
        messages: messages as OpenAIChatMessage[],
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stop,
        stream: true
      };
      
      // Create cancel token
      this.cancelTokenSource = axios.CancelToken.source();
      
      // Send request
      const response = await this.client.post<NodeJS.ReadableStream>(
        '/chat/completions',
        request,
        {
          cancelToken: this.cancelTokenSource.token,
          timeout: options.timeout || this.config.timeout,
          responseType: 'stream'
        }
      );
      
      // Process streaming response
      let fullContent = '';
      let responseId = '';
      let responseModel = '';
      let responseCreated = 0;
      let finishReason = '';
      
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
              if (line.trim() === '') {
                continue;
              }
              if (line.trim() === 'data: [DONE]') {
                callback('', true);
                continue;
              }
              
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                const data = JSON.parse(jsonStr) as OpenAIStreamChunk;
                
                // Store response metadata from first chunk
                if (!responseId) {
                  responseId = data.id;
                  responseModel = data.model;
                  responseCreated = data.created;
                }
                
                // Extract content
                const content = data.choices[0].delta.content || '';
                fullContent += content;
                
                // Check for finish reason
                if (data.choices[0].finish_reason) {
                  finishReason = data.choices[0].finish_reason;
                }
                
                // Send content to callback
                callback(content, false);
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
          if (buffer.trim() !== '') {
            try {
              if (buffer.trim() === 'data: [DONE]') {
                callback('', true);
              } else if (buffer.startsWith('data: ')) {
                const jsonStr = buffer.slice(6);
                const data = JSON.parse(jsonStr) as OpenAIStreamChunk;
                
                // Extract content
                const content = data.choices[0].delta.content || '';
                fullContent += content;
                
                // Check for finish reason
                if (data.choices[0].finish_reason) {
                  finishReason = data.choices[0].finish_reason;
                }
                
                // Send content to callback
                callback(content, false);
              }
            } catch (error) {
              console.error('Error processing final stream chunk:', error);
            }
          }
          
          // Signal completion
          callback('', true);
          
          // Estimate token usage
          const completionTokens = Math.ceil(fullContent.length / 4);
          const totalTokens = estimatedPromptTokens + completionTokens;
          
          // Update rate limit counters
          this.updateRateLimitCounters(totalTokens);
          
          // Resolve with final response
          resolve({
            id: responseId,
            model: responseModel,
            content: fullContent,
            usage: {
              promptTokens: estimatedPromptTokens,
              completionTokens,
              totalTokens
            },
            finishReason,
            created: responseCreated
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
      console.error('OpenAI streaming chat error:', error);
      
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
          const serverError = new Error(data?.error?.message || 'OpenAI server error');
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
   * @param text The text to generate embeddings for
   * @param options The request options
   */
  public async embeddings(text: string, options: ApiRequestOptions): Promise<number[]> {
    try {
      // Validate model
      const modelConfig = this.getModel(options.model);
      
      if (!modelConfig) {
        throw new Error(`Model ${options.model} not found or not enabled`);
      }
      
      if (!modelConfig.capabilities.includes(ModelCapability.EMBEDDING)) {
        throw new Error(`Model ${options.model} does not support embeddings`);
      }
      
      // Estimate token usage
      const estimatedTokens = Math.ceil(text.length / 4);
      
      // Check rate limits
      const rateLimitCheck = this.checkRateLimit(estimatedTokens);
      
      if (!rateLimitCheck.allowed) {
        const error = new Error(`Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter} seconds.`);
        error['code'] = 'rate_limit_exceeded';
        error['type'] = 'rate_limit';
        error['retryAfter'] = rateLimitCheck.retryAfter;
        throw error;
      }
      
      // Prepare request
      const request: OpenAIEmbeddingRequest = {
        model: options.model,
        input: text
      };
      
      // Create cancel token
      this.cancelTokenSource = axios.CancelToken.source();
      
      // Send request
      const response = await this.client.post<OpenAIEmbeddingResponse>(
        '/embeddings',
        request,
        {
          cancelToken: this.cancelTokenSource.token,
          timeout: options.timeout || this.config.timeout
        }
      );
      
      // Update rate limit counters
      this.updateRateLimitCounters(response.data.usage.total_tokens);
      
      // Return embeddings
      return response.data.data[0].embedding;
    } catch (error) {
      console.error('OpenAI embeddings error:', error);
      
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
          const serverError = new Error(data?.error?.message || 'OpenAI server error');
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
   * Cancels an ongoing request
   */
  public cancelRequest(): void {
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel('Request cancelled by user');
      this.cancelTokenSource = undefined;
    }
  }
}
