import * as vscode from 'vscode';
import { BaseApiProvider, ApiProviderConfig, ApiRequestOptions, ApiResponse, ModelCapability } from './providers/base-provider';
import { OpenAIProvider } from './providers/openai-provider';
import { AnthropicProvider } from './providers/anthropic-provider';
import { SecurityService } from '../security';

// Types
export interface OrchestratorConfig {
  models: {
    [name: string]: ModelConfig;
  };
  timeoutMs: number;
  fallbackBehavior: 'error' | 'retry' | 'alternative';
  providers: {
    [provider: string]: ApiProviderConfig;
  };
}

export interface ModelConfig {
  provider: string;
  modelId: string;
  enabled: boolean;
  priority: number;
  capabilities: string[];
  contextWindow: number;
}

export interface AITask {
  type: string;
  query: string;
  context?: any;
  filePath?: string;
  selection?: {
    start: any;
    end: any;
    text: string;
  };
  options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  };
}

export interface TaskSelector {
  name: string;
  predicate: (task: AITask) => boolean;
  modelPriority: string[];
}

export interface ProviderRegistry {
  [provider: string]: BaseApiProvider;
}

// Main orchestrator class
export class ModelOrchestrator {
  private providers: ProviderRegistry = {};
  private modelSelectors: TaskSelector[] = [];
  private activeRequests: Map<string, { provider: BaseApiProvider; taskId: string }> = new Map();
  
  constructor(
    private readonly config: OrchestratorConfig,
    private readonly securityService: SecurityService
  ) {
    this.initialize();
  }
  
  private async initialize(): Promise<void> {
    try {
      // Initialize providers
      await this.initializeProviders();
      
      // Register task selectors
      this.registerDefaultSelectors();
      
      console.log('Model orchestrator initialized');
    } catch (error) {
      console.error('Failed to initialize model orchestrator:', error);
      vscode.window.showErrorMessage(`Failed to initialize model orchestrator: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async initializeProviders(): Promise<void> {
    // Initialize each provider
    for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
      try {
        if (!providerConfig.enabled) {
          console.log(`Provider ${providerName} is disabled, skipping initialization`);
          continue;
        }
        
        // Create provider instance
        let provider: BaseApiProvider;
        
        switch (providerName) {
          case 'openai':
            provider = new OpenAIProvider(providerConfig, this.securityService);
            break;
          case 'anthropic':
            provider = new AnthropicProvider(providerConfig, this.securityService);
            break;
          default:
            console.warn(`Unknown provider type: ${providerName}, skipping`);
            continue;
        }
        
        // Add to registry
        this.providers[providerName] = provider;
        
        console.log(`Provider ${providerName} initialized`);
      } catch (error) {
        console.error(`Failed to initialize provider ${providerName}:`, error);
      }
    }
    
    // Check if we have at least one provider
    if (Object.keys(this.providers).length === 0) {
      throw new Error('No API providers were successfully initialized');
    }
  }
  
  private registerDefaultSelectors() {
    // Code generation tasks -> code-specialized model
    this.modelSelectors.push({
      name: 'code-generation',
      predicate: (task) => task.type === 'generate' || task.type === 'complete',
      modelPriority: ['code-specialist', 'general-purpose', 'fallback']
    });
    
    // Explanation tasks -> explanation-specialized model
    this.modelSelectors.push({
      name: 'explanation',
      predicate: (task) => task.type === 'explain' || task.type === 'document',
      modelPriority: ['explanation-specialist', 'general-purpose', 'fallback']
    });
    
    // Refactoring tasks -> code-specialized model
    this.modelSelectors.push({
      name: 'refactoring',
      predicate: (task) => task.type === 'refactor',
      modelPriority: ['code-specialist', 'general-purpose', 'fallback']
    });
    
    // Testing tasks -> code-specialized model
    this.modelSelectors.push({
      name: 'testing',
      predicate: (task) => task.type === 'test',
      modelPriority: ['code-specialist', 'general-purpose', 'fallback']
    });
    
    // Default selector for any task
    this.modelSelectors.push({
      name: 'default',
      predicate: () => true,
      modelPriority: ['general-purpose', 'fallback']
    });
  }
  
  /**
   * Adds a custom task selector
   * @param selector The task selector to add
   */
  public addTaskSelector(selector: TaskSelector): void {
    // Add selector at the beginning to give it priority over default selectors
    this.modelSelectors.unshift(selector);
  }
  
  /**
   * Executes an AI task using the appropriate model
   * @param task The task to execute
   * @param streamCallback Optional callback for streaming responses
   */
  public async executeTask(
    task: AITask,
    streamCallback?: (chunk: string, done: boolean) => void
  ): Promise<ApiResponse> {
    // Generate a unique task ID
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    try {
      // Find appropriate selector for this task
      const selector = this.modelSelectors.find(s => s.predicate(task));
      
      if (!selector) {
        throw new Error(`No model selector available for task: ${task.type}`);
      }
      
      // Try models in priority order
      for (const modelName of selector.modelPriority) {
        const modelConfig = this.config.models[modelName];
        
        if (!modelConfig || !modelConfig.enabled) {
          continue;
        }
        
        const provider = this.providers[modelConfig.provider];
        
        if (!provider) {
          console.warn(`Provider ${modelConfig.provider} not found for model ${modelName}`);
          continue;
        }
        
        if (!provider.isConfigured()) {
          console.warn(`Provider ${modelConfig.provider} is not configured (missing API key)`);
          continue;
        }
        
        try {
          // Track active request
          this.activeRequests.set(taskId, { provider, taskId });
          
          // Execute with model
          const result = await this.executeWithModel(
            provider,
            modelConfig.modelId,
            task,
            streamCallback
          );
          
          // Remove from active requests
          this.activeRequests.delete(taskId);
          
          return result;
        } catch (error) {
          console.warn(`Model ${modelName} failed for task ${task.type}:`, error);
          
          // Remove from active requests
          this.activeRequests.delete(taskId);
          
          // Continue to next model in priority list
          if (this.config.fallbackBehavior === 'alternative') {
            continue;
          } else if (this.config.fallbackBehavior === 'error') {
            throw error;
          }
          // For 'retry', we'll just continue to the next model
        }
      }
      
      throw new Error(`All models failed for task: ${task.type}`);
    } catch (error) {
      // Clean up any active request
      this.activeRequests.delete(taskId);
      
      // Re-throw the error
      throw error;
    }
  }
  
  /**
   * Cancels all active requests
   */
  public cancelAllRequests(): void {
    for (const { provider } of this.activeRequests.values()) {
      provider.cancelRequest();
    }
    
    this.activeRequests.clear();
  }
  
  /**
   * Cancels a specific request
   * @param taskId The ID of the task to cancel
   */
  public cancelRequest(taskId: string): void {
    const request = this.activeRequests.get(taskId);
    
    if (request) {
      request.provider.cancelRequest();
      this.activeRequests.delete(taskId);
    }
  }
  
  private async executeWithModel(
    provider: BaseApiProvider,
    modelId: string,
    task: AITask,
    streamCallback?: (chunk: string, done: boolean) => void
  ): Promise<ApiResponse> {
    // Prepare request options
    const options: ApiRequestOptions = {
      model: modelId,
      maxTokens: task.options?.maxTokens || this.getMaxTokensForTask(task),
      temperature: task.options?.temperature || this.getTemperatureForTask(task),
      stream: !!streamCallback
    };
    
    // Format messages based on task
    const messages = this.formatMessagesForTask(task);
    
    // Execute request with timeout
    if (streamCallback) {
      // Streaming request
      return await Promise.race([
        provider.streamingChat(messages, options, streamCallback),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Model timeout')), this.config.timeoutMs)
        )
      ]);
    } else {
      // Non-streaming request
      return await Promise.race([
        provider.chat(messages, options),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Model timeout')), this.config.timeoutMs)
        )
      ]);
    }
  }
  
  private getTemperatureForTask(task: AITask): number {
    // Adjust temperature based on task type
    switch (task.type) {
      case 'generate':
      case 'complete':
        return 0.7; // More creative
      case 'explain':
      case 'document':
        return 0.3; // More factual
      case 'refactor':
      case 'test':
        return 0.2; // More precise
      default:
        return 0.5; // Balanced
    }
  }
  
  private getMaxTokensForTask(task: AITask): number {
    // Adjust max tokens based on task type
    switch (task.type) {
      case 'explain':
      case 'document':
        return 2000; // Longer explanations
      case 'generate':
      case 'complete':
        return 1500; // Code generation
      case 'refactor':
        return 1000; // Code refactoring
      default:
        return 1000; // Default
    }
  }
  
  private formatMessagesForTask(task: AITask): any[] {
    // Format messages based on task type
    const messages: any[] = [];
    
    // System message with instructions
    messages.push({
      role: 'system',
      content: this.getSystemPromptForTask(task)
    });
    
    // Add context if available
    if (task.context && task.context.chunks && task.context.chunks.length > 0) {
      const contextMessage = this.formatContextMessage(task.context);
      messages.push({
        role: 'system',
        content: contextMessage
      });
    }
    
    // User query
    messages.push({
      role: 'user',
      content: task.query
    });
    
    return messages;
  }
  
  private getSystemPromptForTask(task: AITask): string {
    // Base system prompt
    let prompt = 'You are Asura AI, an advanced coding assistant. ';
    
    // Add task-specific instructions
    switch (task.type) {
      case 'explain':
        prompt += 'Provide clear, concise explanations of code. Break down complex concepts into understandable parts. Include examples where helpful.';
        break;
      case 'generate':
        prompt += 'Generate high-quality, well-documented code based on the user\'s requirements. Follow best practices and include comments.';
        break;
      case 'refactor':
        prompt += 'Improve existing code by refactoring it. Focus on readability, performance, and adherence to best practices. Explain your changes.';
        break;
      case 'test':
        prompt += 'Create comprehensive tests for the given code. Cover edge cases and ensure good test coverage. Follow testing best practices.';
        break;
      case 'complete':
        prompt += 'Complete the code based on the context and user\'s requirements. Ensure the completed code is consistent with the existing style.';
        break;
      default:
        prompt += 'Provide helpful assistance with coding tasks. Be clear, concise, and follow best practices.';
    }
    
    return prompt;
  }
  
  private formatContextMessage(context: any): string {
    // Format context chunks into a single message
    let message = 'Here is some relevant context from the codebase:\n\n';
    
    for (const chunk of context.chunks) {
      message += `File: ${chunk.filePath}\n`;
      message += '```\n';
      message += chunk.content;
      message += '\n```\n\n';
    }
    
    return message;
  }
  
  /**
   * Gets all available providers
   */
  public getProviders(): { [provider: string]: BaseApiProvider } {
    return { ...this.providers };
  }
  
  /**
   * Gets all available models
   */
  public getModels(): { [name: string]: ModelConfig & { available: boolean } } {
    const result: { [name: string]: ModelConfig & { available: boolean } } = {};
    
    for (const [name, modelConfig] of Object.entries(this.config.models)) {
      const provider = this.providers[modelConfig.provider];
      const available = !!provider && provider.isConfigured();
      
      result[name] = {
        ...modelConfig,
        available
      };
    }
    
    return result;
  }
  
  /**
   * Gets models that support a specific capability
   * @param capability The capability to filter by
   */
  public getModelsByCapability(capability: string): (ModelConfig & { available: boolean })[] {
    const models = this.getModels();
    
    return Object.entries(models)
      .filter(([_, model]) => 
        model.capabilities.includes(capability) && model.available
      )
      .map(([_, model]) => model)
      .sort((a, b) => b.priority - a.priority);
  }
}
