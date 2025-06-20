import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { promisify } from 'util';

// Promisify child_process.exec
const exec = promisify(cp.exec);

// Types
export interface TestingConfig {
  enabled: boolean;
  testFramework: 'jest' | 'mocha' | 'vitest' | 'auto';
  autoRunTests: boolean;
  showCoverage: boolean;
}

export interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  message?: string;
  location?: {
    file: string;
    line: number;
    column: number;
  };
}

export interface TestSuiteResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  tests: TestResult[];
  coverage?: TestCoverage;
}

export interface TestCoverage {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  files: {
    [filePath: string]: {
      statements: number;
      branches: number;
      functions: number;
      lines: number;
    };
  };
}

// Main testing service
export class TestingService {
  private detectedTestFramework?: 'jest' | 'mocha' | 'vitest';
  private workspaceRoot?: string;
  private initialized: boolean = false;
  private testOutputChannel: vscode.OutputChannel;
  
  constructor(
    private readonly config: TestingConfig,
    private readonly context: vscode.ExtensionContext
  ) {
    this.testOutputChannel = vscode.window.createOutputChannel('Asura AI Testing');
    
    if (this.config.enabled) {
      this.initialize();
    }
  }
  
  private async initialize(): Promise<void> {
    try {
      // Get workspace root
      if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      } else {
        console.log('No workspace folder found');
        return;
      }
      
      // Detect test framework
      await this.detectTestFramework();
      
      // Register commands
      this.registerCommands();
      
      this.initialized = true;
      console.log(`Testing service initialized: ${this.detectedTestFramework}`);
    } catch (error) {
      console.error('Failed to initialize testing service:', error);
      vscode.window.showErrorMessage(`Failed to initialize testing service: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async detectTestFramework(): Promise<void> {
    if (!this.workspaceRoot) {
      return;
    }
    
    if (this.config.testFramework !== 'auto') {
      // Use preferred test framework if specified
      this.detectedTestFramework = this.config.testFramework;
      return;
    }
    
    try {
      // Check package.json for test frameworks
      const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);
      
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      if (dependencies.jest) {
        this.detectedTestFramework = 'jest';
      } else if (dependencies.vitest) {
        this.detectedTestFramework = 'vitest';
      } else if (dependencies.mocha) {
        this.detectedTestFramework = 'mocha';
      } else {
        // Check for config files
        const files = await fs.readdir(this.workspaceRoot);
        
        if (files.some(file => file.includes('jest.config'))) {
          this.detectedTestFramework = 'jest';
        } else if (files.some(file => file.includes('vitest.config'))) {
          this.detectedTestFramework = 'vitest';
        } else if (files.some(file => file.includes('.mocharc'))) {
          this.detectedTestFramework = 'mocha';
        } else {
          // Default to Jest
          this.detectedTestFramework = 'jest';
        }
      }
    } catch (error) {
      console.error('Error detecting test framework:', error);
      // Default to Jest
      this.detectedTestFramework = 'jest';
    }
  }
  
  private registerCommands(): void {
    // Register commands for testing
    this.context.subscriptions.push(
      vscode.commands.registerCommand('asura-ai.runTests', this.runTests.bind(this)),
      vscode.commands.registerCommand('asura-ai.runTestFile', this.runTestFile.bind(this)),
      vscode.commands.registerCommand('asura-ai.generateTests', this.generateTests.bind(this)),
      vscode.commands.registerCommand('asura-ai.showCoverage', this.showCoverage.bind(this))
    );
  }
  
  // Command handlers
  private async runTests(): Promise<TestSuiteResult | undefined> {
    try {
      // Show progress
      return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Running tests...',
        cancellable: true
      }, async (_progress, _token) => {
        // Run tests
        const testResults = await this.executeTests();
        
        // Show results
        this.showTestResults(testResults);
        
        return testResults;
      });
    } catch (error) {
      console.error('Error running tests:', error);
      vscode.window.showErrorMessage(`Failed to run tests: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  
  private async runTestFile(): Promise<TestSuiteResult | undefined> {
    try {
      // Get active file
      const activeEditor = vscode.window.activeTextEditor;
      
      if (!activeEditor) {
        vscode.window.showInformationMessage('No active file to test');
        return undefined;
      }
      
      const filePath = activeEditor.document.uri.fsPath;
      
      // Check if it's a test file
      if (!this.isTestFile(filePath)) {
        const createTest = await vscode.window.showInformationMessage(
          'This doesn\'t appear to be a test file. Would you like to create tests for it?',
          'Create Tests',
          'Cancel'
        );
        
        if (createTest === 'Create Tests') {
          return this.generateTests();
        }
        
        return undefined;
      }
      
      // Show progress
      return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Running tests for ${path.basename(filePath)}...`,
        cancellable: true
      }, async (_progress, _token) => {
        // Run tests for file
        const testResults = await this.executeTests(filePath);
        
        // Show results
        this.showTestResults(testResults);
        
        return testResults;
      });
    } catch (error) {
      console.error('Error running test file:', error);
      vscode.window.showErrorMessage(`Failed to run test file: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  
  private async generateTests(): Promise<TestSuiteResult | undefined> {
    try {
      // Get active file
      const activeEditor = vscode.window.activeTextEditor;
      
      if (!activeEditor) {
        vscode.window.showInformationMessage('No active file to generate tests for');
        return undefined;
      }
      
      const filePath = activeEditor.document.uri.fsPath;
      
      // Check if it's already a test file
      if (this.isTestFile(filePath)) {
        vscode.window.showInformationMessage('This is already a test file');
        return undefined;
      }
      
      // Generate test file path
      const testFilePath = this.getTestFilePath(filePath);
      
      // Check if test file already exists
      try {
        await fs.access(testFilePath);
        
        // Test file exists
        const overwrite = await vscode.window.showWarningMessage(
          `Test file already exists at ${testFilePath}. Overwrite?`,
          'Overwrite',
          'Cancel'
        );
        
        if (overwrite !== 'Overwrite') {
          return undefined;
        }
      } catch (error) {
        // Test file doesn't exist, that's fine
      }
      
      // Get file content
      const fileContent = activeEditor.document.getText();
      
      // Generate test content
      const testContent = await this.generateTestContent(filePath, fileContent);
      
      // Create test file
      await fs.mkdir(path.dirname(testFilePath), { recursive: true });
      await fs.writeFile(testFilePath, testContent);
      
      // Open test file
      const document = await vscode.workspace.openTextDocument(testFilePath);
      await vscode.window.showTextDocument(document);
      
      vscode.window.showInformationMessage(`Test file generated at ${testFilePath}`);
      
      return undefined;
    } catch (error) {
      console.error('Error generating tests:', error);
      vscode.window.showErrorMessage(`Failed to generate tests: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  
  private async showCoverage(): Promise<void> {
    try {
      // Run tests with coverage
      const testResults = await this.executeTests(undefined, true);
      
      if (!testResults.coverage) {
        vscode.window.showInformationMessage('No coverage information available');
        return;
      }
      
      // Show coverage
      const panel = vscode.window.createWebviewPanel(
        'testCoverage',
        'Test Coverage',
        vscode.ViewColumn.One,
        {
          enableScripts: true
        }
      );
      
      panel.webview.html = this.getCoverageHtml(testResults.coverage);
    } catch (error) {
      console.error('Error showing coverage:', error);
      vscode.window.showErrorMessage(`Failed to show coverage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Helper methods
  private async executeTests(testFile?: string, withCoverage: boolean = false): Promise<TestSuiteResult> {
    if (!this.workspaceRoot || !this.detectedTestFramework) {
      throw new Error('Testing service not initialized');
    }
    
    let command: string;
    
    switch (this.detectedTestFramework) {
      case 'jest':
        command = `npx jest ${testFile ? testFile : ''} ${withCoverage ? '--coverage' : ''} --json`;
        break;
      case 'vitest':
        command = `npx vitest run ${testFile ? testFile : ''} ${withCoverage ? '--coverage' : ''} --reporter json`;
        break;
      case 'mocha':
        command = `npx mocha ${testFile ? testFile : ''} ${withCoverage ? '--coverage' : ''} --reporter json`;
        break;
      default:
        throw new Error(`Unsupported test framework: ${this.detectedTestFramework}`);
    }
    
    try {
      // Clear output channel
      this.testOutputChannel.clear();
      this.testOutputChannel.appendLine(`Running command: ${command}`);
      this.testOutputChannel.appendLine('');
      
      // Run command
      const { stdout, stderr } = await exec(command, { cwd: this.workspaceRoot });
      
      if (stderr) {
        this.testOutputChannel.appendLine('STDERR:');
        this.testOutputChannel.appendLine(stderr);
        this.testOutputChannel.appendLine('');
      }
      
      this.testOutputChannel.appendLine('STDOUT:');
      this.testOutputChannel.appendLine(stdout);
      
      // Parse results
      return this.parseTestResults(stdout, this.detectedTestFramework);
    } catch (error) {
      // The command might exit with non-zero status if tests fail
      const stderr = (error as any).stderr;
      const stdout = (error as any).stdout;
      
      if (stderr) {
        this.testOutputChannel.appendLine('STDERR:');
        this.testOutputChannel.appendLine(stderr);
        this.testOutputChannel.appendLine('');
      }
      
      if (stdout) {
        this.testOutputChannel.appendLine('STDOUT:');
        this.testOutputChannel.appendLine(stdout);
        
        // Try to parse results from stdout
        try {
          return this.parseTestResults(stdout, this.detectedTestFramework);
        } catch (parseError) {
          console.error('Error parsing test results:', parseError);
        }
      }
      
      // If we couldn't parse results, return a generic failure
      return {
        name: 'Test Suite',
        status: 'failed',
        duration: 0,
        tests: [],
        coverage: undefined
      };
    }
  }
  
  private parseTestResults(output: string, framework: 'jest' | 'mocha' | 'vitest'): TestSuiteResult {
    try {
      // Find JSON in output
      const jsonStart = output.indexOf('{');
      const jsonEnd = output.lastIndexOf('}');
      
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('No JSON found in test output');
      }
      
      const jsonStr = output.substring(jsonStart, jsonEnd + 1);
      const result = JSON.parse(jsonStr);
      
      // Different frameworks have different output formats
      switch (framework) {
        case 'jest':
          return this.parseJestResults(result);
        case 'vitest':
          return this.parseVitestResults(result);
        case 'mocha':
          return this.parseMochaResults(result);
        default:
          throw new Error(`Unsupported test framework: ${framework}`);
      }
    } catch (error) {
      console.error('Error parsing test results:', error);
      throw new Error(`Failed to parse test results: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private parseJestResults(result: any): TestSuiteResult {
    const tests: TestResult[] = [];
    
    // Parse test results
    for (const testResult of result.testResults) {
      for (const assertionResult of testResult.assertionResults) {
        tests.push({
          name: assertionResult.fullName || assertionResult.title,
          status: assertionResult.status === 'passed' ? 'passed' : (assertionResult.status === 'pending' ? 'skipped' : 'failed'),
          duration: assertionResult.duration || 0,
          message: assertionResult.failureMessages?.join('\n'),
          location: {
            file: testResult.name,
            line: 0,
            column: 0
          }
        });
      }
    }
    
    // Parse coverage
    let coverage: TestCoverage | undefined;
    
    if (result.coverageMap) {
      const files: { [filePath: string]: any } = {};
      
      for (const [filePath, fileCoverage] of Object.entries(result.coverageMap)) {
        const typedCoverage = fileCoverage as any;
        const summary = typedCoverage.toSummary();
        
        files[filePath] = {
          statements: summary.statements.pct,
          branches: summary.branches.pct,
          functions: summary.functions.pct,
          lines: summary.lines.pct
        };
      }
      
      const totalSummary = result.coverageMap.getCoverageSummary();
      
      coverage = {
        statements: totalSummary.statements.pct,
        branches: totalSummary.branches.pct,
        functions: totalSummary.functions.pct,
        lines: totalSummary.lines.pct,
        files
      };
    }
    
    return {
      name: 'Jest Test Suite',
      status: result.success ? 'passed' : 'failed',
      duration: result.startTime ? (Date.now() - result.startTime) : 0,
      tests,
      coverage
    };
  }
  
  private parseVitestResults(result: any): TestSuiteResult {
    const tests: TestResult[] = [];
    
    // Parse test results
    for (const testFile of result.testFiles) {
      for (const task of testFile.tasks) {
        tests.push({
          name: task.name,
          status: task.result?.state === 'pass' ? 'passed' : (task.result?.state === 'skip' ? 'skipped' : 'failed'),
          duration: task.result?.duration || 0,
          message: task.result?.errors?.map((e: any) => e.message).join('\n'),
          location: {
            file: testFile.name,
            line: task.location?.line || 0,
            column: task.location?.column || 0
          }
        });
      }
    }
    
    // Parse coverage
    let coverage: TestCoverage | undefined;
    
    if (result.coverage) {
      const files: { [filePath: string]: any } = {};
      
      for (const [filePath, fileCoverage] of Object.entries(result.coverage.files)) {
        const typedCoverage = fileCoverage as any;
        files[filePath] = {
          statements: typedCoverage.statements.pct,
          branches: typedCoverage.branches.pct,
          functions: typedCoverage.functions.pct,
          lines: typedCoverage.lines.pct
        };
      }
      
      coverage = {
        statements: result.coverage.total.statements.pct,
        branches: result.coverage.total.branches.pct,
        functions: result.coverage.total.functions.pct,
        lines: result.coverage.total.lines.pct,
        files
      };
    }
    
    return {
      name: 'Vitest Test Suite',
      status: result.state === 'pass' ? 'passed' : 'failed',
      duration: result.duration || 0,
      tests,
      coverage
    };
  }
  
  private parseMochaResults(result: any): TestSuiteResult {
    const tests: TestResult[] = [];
    
    // Parse test results
    const parseTests = (suite: any) => {
      if (suite.tests) {
        for (const test of suite.tests) {
          tests.push({
            name: test.fullTitle || test.title,
            status: test.state === 'passed' ? 'passed' : (test.pending ? 'skipped' : 'failed'),
            duration: test.duration || 0,
            message: test.err?.message,
            location: {
              file: test.file || '',
              line: 0,
              column: 0
            }
          });
        }
      }
      
      if (suite.suites) {
        for (const childSuite of suite.suites) {
          parseTests(childSuite);
        }
      }
    };
    
    parseTests(result);
    
    // Mocha doesn't have built-in coverage
    
    return {
      name: 'Mocha Test Suite',
      status: result.stats.failures > 0 ? 'failed' : 'passed',
      duration: result.stats.duration || 0,
      tests
    };
  }
  
  private showTestResults(testResults: TestSuiteResult): void {
    // Show test results in a webview
    const panel = vscode.window.createWebviewPanel(
      'testResults',
      'Test Results',
      vscode.ViewColumn.One,
      {
        enableScripts: true
      }
    );
    
    panel.webview.html = this.getTestResultsHtml(testResults);
    
    // Show notification
    const passedCount = testResults.tests.filter(t => t.status === 'passed').length;
    const failedCount = testResults.tests.filter(t => t.status === 'failed').length;
    const skippedCount = testResults.tests.filter(t => t.status === 'skipped').length;
    
    if (failedCount > 0) {
      vscode.window.showErrorMessage(`Tests completed with ${failedCount} failures`);
    } else {
      vscode.window.showInformationMessage(`All tests passed (${passedCount} tests, ${skippedCount} skipped)`);
    }
  }
  
  private getTestResultsHtml(testResults: TestSuiteResult): string {
    // Count test results
    const passedCount = testResults.tests.filter(t => t.status === 'passed').length;
    const failedCount = testResults.tests.filter(t => t.status === 'failed').length;
    const skippedCount = testResults.tests.filter(t => t.status === 'skipped').length;
    
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test Results</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
          }
          .summary {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
          }
          .summary-item {
            text-align: center;
            padding: 10px;
            border-radius: 5px;
          }
          .summary-item h3 {
            margin: 0;
          }
          .summary-item p {
            font-size: 24px;
            font-weight: bold;
            margin: 10px 0 0 0;
          }
          .passed {
            background-color: rgba(0, 255, 0, 0.2);
          }
          .failed {
            background-color: rgba(255, 0, 0, 0.2);
          }
          .skipped {
            background-color: rgba(255, 255, 0, 0.2);
          }
          .test {
            margin-bottom: 10px;
            padding: 10px;
            border-radius: 5px;
          }
          .test h3 {
            margin-top: 0;
          }
          .test-passed {
            border-left: 5px solid green;
            background-color: rgba(0, 255, 0, 0.1);
          }
          .test-failed {
            border-left: 5px solid red;
            background-color: rgba(255, 0, 0, 0.1);
          }
          .test-skipped {
            border-left: 5px solid yellow;
            background-color: rgba(255, 255, 0, 0.1);
          }
          .error-message {
            font-family: monospace;
            white-space: pre-wrap;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 10px;
            border-radius: 5px;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <h1>Test Results</h1>
        
        <div class="summary">
          <div class="summary-item passed">
            <h3>Passed</h3>
            <p>${passedCount}</p>
          </div>
          <div class="summary-item failed">
            <h3>Failed</h3>
            <p>${failedCount}</p>
          </div>
          <div class="summary-item skipped">
            <h3>Skipped</h3>
            <p>${skippedCount}</p>
          </div>
        </div>
        
        <h2>Tests</h2>
        ${testResults.tests.map(test => `
          <div class="test test-${test.status}">
            <h3>${test.name}</h3>
            <p><strong>Status:</strong> ${test.status}</p>
            <p><strong>Duration:</strong> ${test.duration}ms</p>
            ${test.location ? `<p><strong>File:</strong> ${test.location.file}:${test.location.line}:${test.location.column}</p>` : ''}
            ${test.message ? `<div class="error-message">${test.message}</div>` : ''}
          </div>
        `).join('')}
      </body>
      </html>
    `;
  }
  
  private getCoverageHtml(coverage: TestCoverage): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test Coverage</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
          }
          .summary {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
          }
          .summary-item {
            text-align: center;
            padding: 10px;
            border-radius: 5px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
          }
          .summary-item h3 {
            margin: 0;
          }
          .summary-item p {
            font-size: 24px;
            font-weight: bold;
            margin: 10px 0 0 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          th {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
          }
          .coverage-bar {
            height: 20px;
            background-color: #f0f0f0;
            border-radius: 10px;
            overflow: hidden;
          }
          .coverage-value {
            height: 100%;
            background-color: #4CAF50;
          }
          .low-coverage {
            background-color: #F44336;
          }
          .medium-coverage {
            background-color: #FFC107;
          }
          .high-coverage {
            background-color: #4CAF50;
          }
        </style>
      </head>
      <body>
        <h1>Test Coverage</h1>
        
        <div class="summary">
          <div class="summary-item">
            <h3>Statements</h3>
            <p>${coverage.statements.toFixed(2)}%</p>
          </div>
          <div class="summary-item">
            <h3>Branches</h3>
            <p>${coverage.branches.toFixed(2)}%</p>
          </div>
          <div class="summary-item">
            <h3>Functions</h3>
            <p>${coverage.functions.toFixed(2)}%</p>
          </div>
          <div class="summary-item">
            <h3>Lines</h3>
            <p>${coverage.lines.toFixed(2)}%</p>
          </div>
        </div>
        
        <h2>Files</h2>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Statements</th>
              <th>Branches</th>
              <th>Functions</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(coverage.files).map(([filePath, fileCoverage]) => `
              <tr>
                <td>${filePath}</td>
                <td>
                  <div class="coverage-bar">
                    <div class="coverage-value ${this.getCoverageClass(fileCoverage.statements)}" style="width: ${fileCoverage.statements}%"></div>
                  </div>
                  ${fileCoverage.statements.toFixed(2)}%
                </td>
                <td>
                  <div class="coverage-bar">
                    <div class="coverage-value ${this.getCoverageClass(fileCoverage.branches)}" style="width: ${fileCoverage.branches}%"></div>
                  </div>
                  ${fileCoverage.branches.toFixed(2)}%
                </td>
                <td>
                  <div class="coverage-bar">
                    <div class="coverage-value ${this.getCoverageClass(fileCoverage.functions)}" style="width: ${fileCoverage.functions}%"></div>
                  </div>
                  ${fileCoverage.functions.toFixed(2)}%
                </td>
                <td>
                  <div class="coverage-bar">
                    <div class="coverage-value ${this.getCoverageClass(fileCoverage.lines)}" style="width: ${fileCoverage.lines}%"></div>
                  </div>
                  ${fileCoverage.lines.toFixed(2)}%
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
  
  private getCoverageClass(coverage: number): string {
    if (coverage < 50) {
      return 'low-coverage';
    } else if (coverage < 80) {
      return 'medium-coverage';
    } else {
      return 'high-coverage';
    }
  }
  
  private isTestFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return fileName.includes('.test.') || fileName.includes('.spec.') || fileName.includes('_test.') || fileName.includes('_spec.');
  }
  
  private getTestFilePath(filePath: string): string {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    
    // Check if there's a __tests__ directory
    const testsDir = path.join(dir, '__tests__');
    
    try {
      fs.access(testsDir);
      return path.join(testsDir, `${baseName}.test${ext}`);
    } catch (error) {
      // No __tests__ directory, use same directory
      return path.join(dir, `${baseName}.test${ext}`);
    }
  }
  
  private async generateTestContent(filePath: string, fileContent: string): Promise<string> {
    // In a real implementation, this would use AI to generate tests
    // For this demo, we'll use a simple template
    
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    
    // Extract exports from file content
    const exports: string[] = [];
    
    // Simple regex to find exports
    const exportRegex = /export\s+(const|function|class|interface|type|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let match;
    
    while ((match = exportRegex.exec(fileContent)) !== null) {
      exports.push(match[2]);
    }
    
    // Generate test template based on file type
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      // JavaScript/TypeScript test template
      return this.generateJsTestTemplate(baseName, exports);
    } else {
      // Generic test template
      return `// Tests for ${baseName}\n\n// Add your tests here\n`;
    }
  }
  
  private generateJsTestTemplate(baseName: string, exports: string[]): string {
    const importPath = `./${baseName}`;
    
    let template = `import { ${exports.join(', ')} } from '${importPath}';\n\n`;
    
    template += `describe('${baseName}', () => {\n`;
    
    for (const exportName of exports) {
      template += `  describe('${exportName}', () => {\n`;
      template += `    test('should work correctly', () => {\n`;
      template += `      // TODO: Add test implementation\n`;
      template += `      expect(true).toBe(true);\n`;
      template += `    });\n`;
      template += `  });\n\n`;
    }
    
    template += `});\n`;
    
    return template;
  }
}
