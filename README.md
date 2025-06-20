# Asura AI

Asura AI is an advanced AI coding assistant with multi-model capabilities and semantic context management for VS Code.

## Features

- **Multi-Model Orchestration**: Intelligently selects the best AI model for each specific task
- **Semantic Context Management**: Understands your codebase at a deeper level
- **Proactive Code Analysis**: Identifies potential issues before they become problems
- **Robust Security**: Secure handling of API keys and code execution
- **Flexible API Integration**: Support for multiple AI providers

## Key Capabilities

- **Code Generation**: Create high-quality, well-documented code
- **Code Explanation**: Get clear, concise explanations of complex code
- **Refactoring**: Improve existing code with intelligent suggestions
- **Testing**: Generate comprehensive tests for your code
- **Documentation**: Create detailed documentation for your projects

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Configure your API keys in the extension settings
3. Open a project and start using Asura AI with the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and type "Start Asura AI Assistant"
4. Ask questions, request code generation, or get explanations directly in VS Code

## Requirements

- VS Code 1.60.0 or higher
- An OpenAI API key

## Extension Settings

This extension contributes the following settings:

* `asura-ai.apiKeys.openai`: Your OpenAI API key
* `asura-ai.security.encryptionEnabled`: Enable encryption for API keys
* `asura-ai.security.auditLoggingEnabled`: Enable audit logging
* `asura-ai.security.sandboxExecution`: Enable sandboxed execution

## Known Issues

- Initial loading of large codebases may take some time

## Release Notes

### 1.0.0

- Initial release of Asura AI

## Deployment

To deploy the extension, we provide a convenient deployment script:

1. Make sure the script is executable:
   ```bash
   chmod +x deploy.sh
   ```

2. Run the deployment script:
   ```bash
   ./deploy.sh
   ```

The script will:
- Install dependencies
- Run linting checks
- Compile the extension
- Package it into a VSIX file

After successful packaging, you'll have several options:

### Local Installation
```bash
code --install-extension asura-ai-x.x.x.vsix
```

### Publishing to VS Code Marketplace
```bash
npx vsce publish
```
Note: You need to be logged in with `vsce login` and have the appropriate permissions.

### Publishing to Open VSX Registry
```bash
npx ovsx publish asura-ai-x.x.x.vsix
```
Note: You need to set the OVSX_PAT environment variable with your Open VSX token.

## License

