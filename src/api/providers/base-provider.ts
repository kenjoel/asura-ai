import * as vscode from 'vscode';
import { SecurityService } from '../../security';

// Types
export interface ApiProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  apiKey?: string;
  apiEndpoint?: string;
  apiVersion?: string;
  maxTokens?: number;
  timeout?: number;
  rateLimitRPM?: number;
  rateLimitTPM?: number;
  models: ModelConfig[];
}

export interface ModelConfig {
  id: string;
  name: string;
  enabled: boolean;
  maxTokens: number;
  contextWindow: number;
  capabilities: ModelCapability[];
  costPer1KTokens: {
    input: number;
    output: number;
  };
}

export enum ModelCapability {
  COMPLETION = 'completion',
  CHAT = 'chat',
  EMBEDDING = 'embedding',
  CODE = 'code',
  FUNCTION_CALLING = 'function_calling',
  IMAGE_GENERATION = 'image_generation',
  IMAGE_UNDERSTANDING = 'image_understanding',
  AUDIO_TRANSCRIPTION = 'audio_transcription',
  AUDIO_GENERATION = 'audio_generation'
}

export interface ApiRequestOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  timeout?: number;
  stream?: boolean;
}

export interface ApiResponse {
  id: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  created: number;
}

export interface ApiError {
  code: string;
  message: string;
  type: 'rate_limit' | 'invalid_request' | 'authentication' | 'server_error' | 'timeout' | 'unknown';
  retryAfter?: number;
}

export interface RateLimitState {
  requestsThisMinute: number;
  tokensThisMinute: number;
  lastRequestTime: number;
  lastResetTime: number;
}

// Base API provider class
export abstract class BaseApiProvider {
  protected rateLimitState: RateLimitState = {
    requestsThisMinute: 0,
    tokensThisMinute: 0,
    lastRequestTime: 0,
    lastResetTime: Date.now()
  };
  
  protected apiKey?: string;
  
  constructor(
    protected readonly config: ApiProviderConfig,
    protected readonly securityService: SecurityService
  ) {
    this.initialize();
  }
  
  private async initialize(): Promise<void> {
    try {
      // Load API key if not provided in config
      if (!this.config.apiKey) {
        const apiKeyId = `api.${this.config.id}.key`;
        this.apiKey = await this.securityService.secureRetrieve(apiKeyId);
      } else {
        this.apiKey = this.config.apiKey;
      }
      
      console.log(`Initialized API provider: ${this.config.name}`);
    } catch (error) {
      console.error(`Failed to initialize API provider ${this.config.name}:`, error);
      vscode.window.showErrorMessage(`Failed to initialize API provider ${this.config.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Sets the API key for this provider
   * @param apiKey The API key to set
   */
  public async setApiKey(apiKey: string): Promise<void> {
    try {
      // Store API key securely
      const apiKeyId = `api.${this.config.id}.key`;
      await this.securityService.secureStore(apiKeyId, apiKey);
      
      // Update in-memory API key
      this.apiKey = apiKey;
      
      console.log(`API key set for provider: ${this.config.name}`);
    } catch (error) {
      console.error(`Failed to set API key for provider ${this.config.name}:`, error);
      throw new Error(`Failed to set API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Clears the API key for this provider
   */
  public async clearApiKey(): Promise<void> {
    try {
      // Remove API key from secure storage
      const apiKeyId = `api.${this.config.id}.key`;
      await this.securityService.secureDelete(apiKeyId);
      
      // Clear in-memory API key
      this.apiKey = undefined;
      
      console.log(`API key cleared for provider: ${this.config.name}`);
    } catch (error) {
      console.error(`Failed to clear API key for provider ${this.config.name}:`, error);
      throw new Error(`Failed to clear API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Checks if the provider is configured and ready to use
   */
  public isConfigured(): boolean {
    return !!this.apiKey;
  }
  
  /**
   * Gets the available models for this provider
   */
  public getModels(): ModelConfig[] {
    return this.config.models.filter(model => model.enabled);
  }
  
  /**
   * Gets a model by ID
   * @param modelId The ID of the model to get
   */
  public getModel(modelId: string): ModelConfig | undefined {
    return this.config.models.find(model => model.id === modelId && model.enabled);
  }
  
  /**
   * Checks if the provider supports a specific capability
   * @param capability The capability to check
   */
  public supportsCapability(capability: ModelCapability): boolean {
    return this.config.models.some(model => 
      model.enabled && model.capabilities.includes(capability)
    );
  }
  
  /**
   * Gets models that support a specific capability
   * @param capability The capability to filter by
   */
  public getModelsByCapability(capability: ModelCapability): ModelConfig[] {
    return this.config.models.filter(model => 
      model.enabled && model.capabilities.includes(capability)
    );
  }
  
  /**
   * Checks if a request would exceed rate limits
   * @param estimatedTokens The estimated number of tokens for the request
   */
  protected checkRateLimit(estimatedTokens: number): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const elapsedSinceReset = now - this.rateLimitState.lastResetTime;
    
    // Reset counters if a minute has passed
    if (elapsedSinceReset >= 60000) {
      this.rateLimitState = {
        requestsThisMinute: 0,
        tokensThisMinute: 0,
        lastRequestTime: now,
        lastResetTime: now
      };
      return { allowed: true };
    }
    
    // Check request rate limit
    if (this.config.rateLimitRPM && this.rateLimitState.requestsThisMinute >= this.config.rateLimitRPM) {
      const retryAfter = Math.ceil((60000 - elapsedSinceReset) / 1000);
      return { allowed: false, retryAfter };
    }
    
    // Check token rate limit
    if (this.config.rateLimitTPM && this.rateLimitState.tokensThisMinute + estimatedTokens > this.config.rateLimitTPM) {
      const retryAfter = Math.ceil((60000 - elapsedSinceReset) / 1000);
      return { allowed: false, retryAfter };
    }
    
    return { allowed: true };
  }
  
  /**
   * Updates rate limit counters after a request
   * @param tokens The number of tokens used in the request
   */
  protected updateRateLimitCounters(tokens: number): void {
    const now = Date.now();
    const elapsedSinceReset = now - this.rateLimitState.lastResetTime;
    
    // Reset counters if a minute has passed
    if (elapsedSinceReset >= 60000) {
      this.rateLimitState = {
        requestsThisMinute: 1,
        tokensThisMinute: tokens,
        lastRequestTime: now,
        lastResetTime: now
      };
    } else {
      // Update counters
      this.rateLimitState.requestsThisMinute++;
      this.rateLimitState.tokensThisMinute += tokens;
      this.rateLimitState.lastRequestTime = now;
    }
  }
  
  /**
   * Calculates the cost of a request
   * @param model The model used
   * @param promptTokens The number of prompt tokens
   * @param completionTokens The number of completion tokens
   */
  public calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const modelConfig = this.getModel(model);
    
    if (!modelConfig) {
      return 0;
    }
    
    const promptCost = (promptTokens / 1000) * modelConfig.costPer1KTokens.input;
    const completionCost = (completionTokens / 1000) * modelConfig.costPer1KTokens.output;
    
    return promptCost + completionCost;
  }
  
  // Abstract methods to be implemented by specific providers
  
  /**
   * Sends a completion request to the API
   * @param prompt The prompt to complete
   * @param options The request options
   */
  public abstract completion(prompt: string, options: ApiRequestOptions): Promise<ApiResponse>;
  
  /**
   * Sends a chat completion request to the API
   * @param messages The chat messages
   * @param options The request options
   */
  public abstract chat(messages: any[], options: ApiRequestOptions): Promise<ApiResponse>;
  
  /**
   * Sends a streaming chat completion request to the API
   * @param messages The chat messages
   * @param options The request options
   * @param callback The callback to receive chunks of the response
   */
  public abstract streamingChat(
    messages: any[],
    options: ApiRequestOptions,
    callback: (chunk: string, done: boolean) => void
  ): Promise<ApiResponse>;
  
  /**
   * Generates embeddings for a text
   * @param text The text to generate embeddings for
   * @param options The request options
   */
  public abstract embeddings(text: string, options: ApiRequestOptions): Promise<number[]>;
  
  /**
   * Cancels an ongoing streaming request
   */
  public abstract cancelRequest(): void;
}
