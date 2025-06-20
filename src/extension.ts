import * as vscode from 'vscode';
import { ModelOrchestrator } from './api/orchestrator';
import { SemanticContextManager } from './core/context/semantic-manager';
import { CodeAnalyzer } from './services/analysis/code-analyzer';
import { SecurityService } from './security';
import { CodeSecurityScanner } from './security/code-security-scanner';
import { ApiProviderConfig, ModelConfig as ProviderModelConfig, ModelCapability } from './api/providers/base-provider';

// Configuration for the extension
interface AsuraConfig {
  providers: {
    [provider: string]: {
      id: string;
      name: string;
      enabled: boolean;
      priority: number;
      apiEndpoint?: string;
      apiVersion?: string;
      timeout?: number;
      rateLimitRPM?: number;
      rateLimitTPM?: number;
      models: ProviderModelConfig[];
    };
  };
  models: {
    [name: string]: {
      provider: string;
      modelId: string;
      enabled: boolean;
      priority: number;
      capabilities: string[];
      contextWindow: number;
    };
  };
  security: {
    enabled: boolean;
    encryptionEnabled: boolean;
    auditLoggingEnabled: boolean;
    sandboxingEnabled: boolean;
    secureStoragePath: string;
    auditLogPath: string;
  };
  orchestrator: {
    timeoutMs: number;
    fallbackBehavior: 'error' | 'retry' | 'alternative';
  };
}

// Default configuration
const defaultConfig: AsuraConfig = {
  providers: {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      enabled: true,
      priority: 10,
      apiEndpoint: 'https://api.openai.com/v1',
      timeout: 30000,
      rateLimitRPM: 60,
      rateLimitTPM: 100000,
      models: [
        {
          id: 'gpt-4',
          name: 'GPT-4',
          enabled: true,
          maxTokens: 4096,
          contextWindow: 8192,
          capabilities: [
            ModelCapability.COMPLETION,
            ModelCapability.CHAT,
            ModelCapability.CODE,
            ModelCapability.FUNCTION_CALLING
          ],
          costPer1KTokens: {
            input: 0.03,
            output: 0.06
          }
        },
        {
          id: 'gpt-3.5-turbo',
          name: 'GPT-3.5 Turbo',
          enabled: true,
          maxTokens: 4096,
          contextWindow: 4096,
          capabilities: [
            ModelCapability.COMPLETION,
            ModelCapability.CHAT,
            ModelCapability.CODE,
            ModelCapability.FUNCTION_CALLING
          ],
          costPer1KTokens: {
            input: 0.0015,
            output: 0.002
          }
        },
        {
          id: 'text-embedding-ada-002',
          name: 'Text Embedding Ada 002',
          enabled: true,
          maxTokens: 8191,
          contextWindow: 8191,
          capabilities: [ModelCapability.EMBEDDING],
          costPer1KTokens: {
            input: 0.0001,
            output: 0.0
          }
        }
      ]
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      enabled: true,
      priority: 8,
      apiEndpoint: 'https://api.anthropic.com',
      apiVersion: '2023-06-01',
      timeout: 30000,
      rateLimitRPM: 50,
      rateLimitTPM: 100000,
      models: [
        {
          id: 'claude-3-opus',
          name: 'Claude 3 Opus',
          enabled: true,
          maxTokens: 4096,
          contextWindow: 200000,
          capabilities: [
            ModelCapability.CHAT,
            ModelCapability.CODE,
            ModelCapability.FUNCTION_CALLING,
            ModelCapability.IMAGE_UNDERSTANDING
          ],
          costPer1KTokens: {
            input: 0.015,
            output: 0.075
          }
        },
        {
          id: 'claude-3-sonnet',
          name: 'Claude 3 Sonnet',
          enabled: true,
          maxTokens: 4096,
          contextWindow: 200000,
          capabilities: [
            ModelCapability.CHAT,
            ModelCapability.CODE,
            ModelCapability.FUNCTION_CALLING,
            ModelCapability.IMAGE_UNDERSTANDING
          ],
          costPer1KTokens: {
            input: 0.003,
            output: 0.015
          }
        }
      ]
    }
  },
  models: {
    'code-specialist': {
      provider: 'openai',
      modelId: 'gpt-4',
      enabled: true,
      priority: 10,
      contextWindow: 8192,
      capabilities: ['code-generation', 'code-explanation', 'refactoring']
    },
    'explanation-specialist': {
      provider: 'anthropic',
      modelId: 'claude-3-sonnet',
      enabled: true,
      priority: 8,
      contextWindow: 100000,
      capabilities: ['explanation', 'documentation', 'summarization']
    },
    'general-purpose': {
      provider: 'openai',
      modelId: 'gpt-3.5-turbo',
      enabled: true,
      priority: 5,
      contextWindow: 4096,
      capabilities: ['general-assistance', 'quick-answers']
    },
    'fallback': {
      provider: 'openai',
      modelId: 'gpt-3.5-turbo',
      enabled: true,
      priority: 1,
      contextWindow: 4096,
      capabilities: ['fallback-assistance']
    }
  },
  security: {
    enabled: true,
    encryptionEnabled: true,
    auditLoggingEnabled: true,
    sandboxingEnabled: true,
    secureStoragePath: '',
    auditLogPath: ''
  },
  orchestrator: {
    timeoutMs: 30000,
    fallbackBehavior: 'alternative'
  }
};

export function activate(context: vscode.ExtensionContext) {
  console.log('Asura AI is now active');

  // Initialize configuration
  const config = context.globalState.get<AsuraConfig>('asuraConfig') || defaultConfig;
  
  // Update paths in config
  config.security.secureStoragePath = context.globalStoragePath + '/secure-storage';
  config.security.auditLogPath = context.globalStoragePath + '/logs/audit.log';
  
  // Initialize core components
  const contextManager = new SemanticContextManager({
    vectorDbPath: context.globalStoragePath + '/vector-db'
  });
  
  // Initialize security service
  const securityService = new SecurityService(config.security, context);
  
  // Initialize security scanner
  const securityScanner = new CodeSecurityScanner(securityService, context);
  
  // Store scanner in context for access
  context.globalState.update('securityScanner', securityScanner);
  
  // Show activation message
  vscode.window.showInformationMessage('Asura AI Security Scanner is now active!');
  
  // Initialize orchestrator
  const orchestrator = new ModelOrchestrator({
    models: config.models,
    providers: config.providers,
    timeoutMs: config.orchestrator.timeoutMs,
    fallbackBehavior: config.orchestrator.fallbackBehavior
  }, securityService);
  
  const codeAnalyzer = new CodeAnalyzer({
    notifyIssues: (filePath, issues) => {
      // Implementation for issue notification
      vscode.window.showInformationMessage(`Asura AI found ${issues.length} issues in ${filePath}`);
    }
  });

  // Register the main command
  let disposable = vscode.commands.registerCommand('asura-ai.start', async () => {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
      vscode.window.showInformationMessage('No active editor found');
      return;
    }
    
    // Get current file content
    const document = editor.document;
    const text = document.getText();
    const filePath = document.fileName;
    
    // Schedule analysis of the current file
    codeAnalyzer.scheduleAnalysis(filePath, text);
    
    // Initialize workspace context if not already done
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder) {
      contextManager.initialize(workspaceFolder.uri.fsPath);
    }
    
    // Show input box for user query
    const query = await vscode.window.showInputBox({
      prompt: 'What would you like Asura AI to help you with?',
      placeHolder: 'e.g., Explain this code, Refactor this function, Generate tests...'
    });
    
    if (!query) {
      return;
    }
    
    // Show progress while processing
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Asura AI is thinking...',
      cancellable: true
    }, async () => {
      try {
        // Get relevant context for the query
        const context = await contextManager.getRelevantContext(query, 2000);
        
        // Create AI task
        const task = {
          type: determineTaskType(query),
          query,
          context,
          filePath,
          selection: editor.selection ? {
            start: editor.selection.start,
            end: editor.selection.end,
            text: editor.document.getText(editor.selection)
          } : undefined
        };
        
        // Execute task with orchestrator
        const response = await orchestrator.executeTask(task);
        
        // Display response
        const panel = vscode.window.createWebviewPanel(
          'asuraResponse',
          'Asura AI Response',
          vscode.ViewColumn.Beside,
          {
            enableScripts: true
          }
        );
        
        panel.webview.html = getWebviewContent(response);
        
      } catch (error) {
        vscode.window.showErrorMessage(`Asura AI error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });

  context.subscriptions.push(disposable);
  
  // Register sidebar view
  const sidebarProvider = new AsuraSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('asura-ai.sidebar', sidebarProvider)
  );
}

// Helper function to determine task type from query
function determineTaskType(query: string): string {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('explain') || lowerQuery.includes('what') || lowerQuery.includes('how')) {
    return 'explain';
  } else if (lowerQuery.includes('refactor') || lowerQuery.includes('improve')) {
    return 'refactor';
  } else if (lowerQuery.includes('generate') || lowerQuery.includes('create')) {
    return 'generate';
  } else if (lowerQuery.includes('test') || lowerQuery.includes('debug')) {
    return 'test';
  } else {
    return 'general';
  }
}

// Helper function to generate webview content
function getWebviewContent(response: any): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Asura AI Response</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          padding: 20px;
          color: var(--vscode-editor-foreground);
          background-color: var(--vscode-editor-background);
        }
        pre {
          background-color: var(--vscode-textCodeBlock-background);
          padding: 16px;
          border-radius: 4px;
          overflow: auto;
        }
        code {
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
        }
        .action-button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 12px;
          border-radius: 2px;
          cursor: pointer;
          margin-right: 8px;
          margin-top: 16px;
        }
        .action-button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <h2>Asura AI Response</h2>
      <div id="response-content">
        ${formatResponse(response)}
      </div>
      <div class="actions">
        <button class="action-button" id="insert-btn">Insert at Cursor</button>
        <button class="action-button" id="copy-btn">Copy to Clipboard</button>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        
        document.getElementById('insert-btn').addEventListener('click', () => {
          vscode.postMessage({
            command: 'insert',
            text: ${JSON.stringify(response.content || '')}
          });
        });
        
        document.getElementById('copy-btn').addEventListener('click', () => {
          vscode.postMessage({
            command: 'copy',
            text: ${JSON.stringify(response.content || '')}
          });
        });
      </script>
    </body>
    </html>
  `;
}

// Helper function to format response
function formatResponse(response: any): string {
  if (!response) {
    return '<p>No response received</p>';
  }
  
  let html = '';
  
  if (response.explanation) {
    html += `<div class="explanation">${response.explanation}</div>`;
  }
  
  if (response.content) {
    html += `<pre><code>${escapeHtml(response.content)}</code></pre>`;
  }
  
  return html;
}

// Helper function to escape HTML
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Sidebar provider class
class AsuraSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    
    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.command) {
        case 'askQuestion':
          vscode.commands.executeCommand('asura-ai.start');
          break;
      }
    });
  }

  private _getHtmlForWebview(_webview: vscode.Webview) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Asura AI</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-editor-foreground);
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 2px;
            cursor: pointer;
            margin-top: 16px;
            width: 100%;
          }
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          .logo {
            width: 100%;
            max-width: 100px;
            margin: 0 auto;
            display: block;
          }
        </style>
      </head>
      <body>
        <img src="https://raw.githubusercontent.com/asura-ai/vscode-extension/main/resources/icon.png" alt="Asura AI Logo" class="logo">
        <h2>Asura AI</h2>
        <p>Advanced AI coding assistant with multi-model capabilities and semantic context management.</p>
        <button id="ask-button">Ask Asura AI</button>
        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('ask-button').addEventListener('click', () => {
            vscode.postMessage({
              command: 'askQuestion'
            });
          });
        </script>
      </body>
      </html>
    `;
  }
}

export function deactivate() {
  // Clean up resources when extension is deactivated
  console.log('Asura AI is now deactivated');
}
