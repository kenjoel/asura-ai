import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { promisify } from 'util';

// Promisify child_process.exec
const exec = promisify(cp.exec);

// Types
export interface PackageManagerConfig {
  enabled: boolean;
  preferredPackageManager: 'npm' | 'yarn' | 'pnpm' | 'auto';
  autoInstallDependencies: boolean;
  securityScanEnabled: boolean;
}

export interface DependencyInfo {
  name: string;
  version: string;
  latest?: string;
  isOutdated?: boolean;
  isDev?: boolean;
  description?: string;
  license?: string;
  vulnerabilities?: DependencyVulnerability[];
}

export interface DependencyVulnerability {
  id: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  description: string;
  fixAvailable: boolean;
  fixedIn?: string;
  url?: string;
}

// Main package manager service
export class PackageManager {
  private detectedPackageManager?: 'npm' | 'yarn' | 'pnpm';
  private workspaceRoot?: string;
  private initialized: boolean = false;
  
  constructor(
    private readonly config: PackageManagerConfig,
    private readonly context: vscode.ExtensionContext
  ) {
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
      
      // Detect package manager
      await this.detectPackageManager();
      
      // Register commands
      this.registerCommands();
      
      this.initialized = true;
      console.log(`Package manager initialized: ${this.detectedPackageManager}`);
    } catch (error) {
      console.error('Failed to initialize package manager:', error);
      vscode.window.showErrorMessage(`Failed to initialize package manager: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async detectPackageManager(): Promise<void> {
    if (!this.workspaceRoot) {
      return;
    }
    
    // Check for lock files to determine package manager
    try {
      const files = await fs.readdir(this.workspaceRoot);
      
      if (this.config.preferredPackageManager !== 'auto') {
        // Use preferred package manager if specified
        this.detectedPackageManager = this.config.preferredPackageManager;
      } else if (files.includes('yarn.lock')) {
        this.detectedPackageManager = 'yarn';
      } else if (files.includes('pnpm-lock.yaml')) {
        this.detectedPackageManager = 'pnpm';
      } else {
        // Default to npm
        this.detectedPackageManager = 'npm';
      }
    } catch (error) {
      console.error('Error detecting package manager:', error);
      // Default to npm
      this.detectedPackageManager = 'npm';
    }
  }
  
  private registerCommands(): void {
    // Register commands for package management
    this.context.subscriptions.push(
      vscode.commands.registerCommand('asura-ai.installDependency', this.installDependency.bind(this)),
      vscode.commands.registerCommand('asura-ai.updateDependencies', this.updateDependencies.bind(this)),
      vscode.commands.registerCommand('asura-ai.analyzeDependencies', this.analyzeDependencies.bind(this)),
      vscode.commands.registerCommand('asura-ai.securityScan', this.securityScan.bind(this))
    );
  }
  
  // Command handlers
  private async installDependency(): Promise<void> {
    try {
      // Get package name
      const packageName = await vscode.window.showInputBox({
        prompt: 'Enter package name to install',
        placeHolder: 'e.g., lodash, react@latest, @types/node'
      });
      
      if (!packageName) {
        return;
      }
      
      // Get dev dependency option
      const isDev = await vscode.window.showQuickPick(
        ['Regular Dependency', 'Development Dependency'],
        { placeHolder: 'Select dependency type' }
      );
      
      if (!isDev) {
        return;
      }
      
      // Install package
      await this.runInstallCommand(packageName, isDev === 'Development Dependency');
      
      vscode.window.showInformationMessage(`Package ${packageName} installed successfully`);
    } catch (error) {
      console.error('Error installing dependency:', error);
      vscode.window.showErrorMessage(`Failed to install dependency: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async updateDependencies(): Promise<void> {
    try {
      // Get dependencies
      const dependencies = await this.getDependencies();
      
      // Filter outdated dependencies
      const outdatedDependencies = dependencies.filter(dep => dep.isOutdated);
      
      if (outdatedDependencies.length === 0) {
        vscode.window.showInformationMessage('All dependencies are up to date');
        return;
      }
      
      // Show outdated dependencies
      const selectedDependency = await vscode.window.showQuickPick(
        outdatedDependencies.map(dep => ({
          label: dep.name,
          description: `${dep.version} → ${dep.latest}`,
          detail: dep.description
        })),
        {
          placeHolder: 'Select dependency to update',
          canPickMany: false
        }
      );
      
      if (!selectedDependency) {
        return;
      }
      
      // Update dependency
      await this.runUpdateCommand(selectedDependency.label);
      
      vscode.window.showInformationMessage(`Package ${selectedDependency.label} updated successfully`);
    } catch (error) {
      console.error('Error updating dependencies:', error);
      vscode.window.showErrorMessage(`Failed to update dependencies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async analyzeDependencies(): Promise<void> {
    try {
      // Get dependencies
      const dependencies = await this.getDependencies();
      
      // Show dependency analysis
      const panel = vscode.window.createWebviewPanel(
        'dependencyAnalysis',
        'Dependency Analysis',
        vscode.ViewColumn.One,
        {
          enableScripts: true
        }
      );
      
      panel.webview.html = this.getDependencyAnalysisHtml(dependencies);
    } catch (error) {
      console.error('Error analyzing dependencies:', error);
      vscode.window.showErrorMessage(`Failed to analyze dependencies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async securityScan(): Promise<void> {
    try {
      // Run security scan
      const vulnerabilities = await this.runSecurityScan();
      
      if (vulnerabilities.length === 0) {
        vscode.window.showInformationMessage('No vulnerabilities found');
        return;
      }
      
      // Show vulnerabilities
      const panel = vscode.window.createWebviewPanel(
        'securityScan',
        'Security Scan Results',
        vscode.ViewColumn.One,
        {
          enableScripts: true
        }
      );
      
      panel.webview.html = this.getSecurityScanHtml(vulnerabilities);
    } catch (error) {
      console.error('Error running security scan:', error);
      vscode.window.showErrorMessage(`Failed to run security scan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Helper methods
  private async runInstallCommand(packageName: string, isDev: boolean): Promise<void> {
    if (!this.workspaceRoot || !this.detectedPackageManager) {
      throw new Error('Package manager not initialized');
    }
    
    let command: string;
    
    switch (this.detectedPackageManager) {
      case 'yarn':
        command = `yarn add ${isDev ? '--dev ' : ''}${packageName}`;
        break;
      case 'pnpm':
        command = `pnpm add ${isDev ? '--save-dev ' : ''}${packageName}`;
        break;
      default:
        command = `npm install ${isDev ? '--save-dev ' : ''}${packageName}`;
    }
    
    // Show progress
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Installing ${packageName}...`,
      cancellable: false
    }, async () => {
      try {
        // Run command
        const { stdout, stderr } = await exec(command, { cwd: this.workspaceRoot });
        
        if (stderr && !stderr.includes('npm WARN')) {
          throw new Error(stderr);
        }
        
        return stdout;
      } catch (error) {
        throw new Error(`Failed to install ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  
  private async runUpdateCommand(packageName: string): Promise<void> {
    if (!this.workspaceRoot || !this.detectedPackageManager) {
      throw new Error('Package manager not initialized');
    }
    
    let command: string;
    
    switch (this.detectedPackageManager) {
      case 'yarn':
        command = `yarn upgrade ${packageName}`;
        break;
      case 'pnpm':
        command = `pnpm update ${packageName}`;
        break;
      default:
        command = `npm update ${packageName}`;
    }
    
    // Show progress
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Updating ${packageName}...`,
      cancellable: false
    }, async () => {
      try {
        // Run command
        const { stdout, stderr } = await exec(command, { cwd: this.workspaceRoot });
        
        if (stderr && !stderr.includes('npm WARN')) {
          throw new Error(stderr);
        }
        
        return stdout;
      } catch (error) {
        throw new Error(`Failed to update ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  
  private async getDependencies(): Promise<DependencyInfo[]> {
    if (!this.workspaceRoot) {
      throw new Error('Package manager not initialized');
    }
    
    // Read package.json
    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    
    // Get dependencies
    const dependencies: DependencyInfo[] = [];
    
    // Regular dependencies
    if (packageJson.dependencies) {
      for (const [name, version] of Object.entries(packageJson.dependencies)) {
        dependencies.push({
          name,
          version: version as string,
          isDev: false
        });
      }
    }
    
    // Dev dependencies
    if (packageJson.devDependencies) {
      for (const [name, version] of Object.entries(packageJson.devDependencies)) {
        dependencies.push({
          name,
          version: version as string,
          isDev: true
        });
      }
    }
    
    // Get outdated packages
    await this.checkOutdatedPackages(dependencies);
    
    return dependencies;
  }
  
  private async checkOutdatedPackages(dependencies: DependencyInfo[]): Promise<void> {
    if (!this.workspaceRoot || !this.detectedPackageManager) {
      return;
    }
    
    let command: string;
    
    switch (this.detectedPackageManager) {
      case 'yarn':
        command = 'yarn outdated --json';
        break;
      case 'pnpm':
        command = 'pnpm outdated --json';
        break;
      default:
        command = 'npm outdated --json';
    }
    
    try {
      // Run command
      const { stdout } = await exec(command, { cwd: this.workspaceRoot });
      
      // Parse output
      const outdatedPackages = JSON.parse(stdout);
      
      // Update dependencies with outdated info
      for (const dep of dependencies) {
        if (outdatedPackages[dep.name]) {
          dep.latest = outdatedPackages[dep.name].latest;
          dep.isOutdated = true;
          dep.description = outdatedPackages[dep.name].description;
        } else {
          dep.isOutdated = false;
        }
      }
    } catch (error) {
      // Ignore errors, as the command might exit with non-zero status if there are outdated packages
      console.log('Error checking outdated packages (this might be normal):', error);
    }
  }
  
  private async runSecurityScan(): Promise<DependencyVulnerability[]> {
    if (!this.workspaceRoot || !this.detectedPackageManager) {
      throw new Error('Package manager not initialized');
    }
    
    let command: string;
    
    switch (this.detectedPackageManager) {
      case 'yarn':
        command = 'yarn audit --json';
        break;
      case 'pnpm':
        command = 'pnpm audit --json';
        break;
      default:
        command = 'npm audit --json';
    }
    
    try {
      // Run command
      const { stdout } = await exec(command, { cwd: this.workspaceRoot });
      
      // Parse output
      const auditResult = JSON.parse(stdout);
      
      // Extract vulnerabilities
      const vulnerabilities: DependencyVulnerability[] = [];
      
      // Different package managers have different output formats
      if (this.detectedPackageManager === 'npm') {
        // NPM format
        for (const [id, vuln] of Object.entries(auditResult.vulnerabilities || {})) {
          const v = vuln as any;
          vulnerabilities.push({
            id,
            severity: v.severity,
            description: v.overview,
            fixAvailable: !!v.fixAvailable,
            fixedIn: v.fixAvailable?.version,
            url: v.url
          });
        }
      } else if (this.detectedPackageManager === 'yarn') {
        // Yarn format
        for (const vuln of (auditResult.data?.vulnerabilities || [])) {
          vulnerabilities.push({
            id: vuln.advisory.id,
            severity: vuln.advisory.severity,
            description: vuln.advisory.title,
            fixAvailable: !!vuln.resolution,
            fixedIn: vuln.resolution?.version,
            url: vuln.advisory.url
          });
        }
      } else {
        // PNPM format
        for (const vuln of (auditResult.vulnerabilities || [])) {
          vulnerabilities.push({
            id: vuln.id,
            severity: vuln.severity,
            description: vuln.title,
            fixAvailable: !!vuln.fixAvailable,
            fixedIn: vuln.fixAvailable?.version,
            url: vuln.url
          });
        }
      }
      
      return vulnerabilities;
    } catch (error) {
      // The command might exit with non-zero status if there are vulnerabilities
      try {
        const stderr = (error as any).stderr;
        if (stderr && stderr.includes('{')) {
          // Try to parse JSON from stderr
          const startIndex = stderr.indexOf('{');
          const jsonStr = stderr.substring(startIndex);
          const auditResult = JSON.parse(jsonStr);
          
          // Extract vulnerabilities (similar to above)
          const vulnerabilities: DependencyVulnerability[] = [];
          
          // Different package managers have different output formats
          if (this.detectedPackageManager === 'npm') {
            // NPM format
            for (const [id, vuln] of Object.entries(auditResult.vulnerabilities || {})) {
              const v = vuln as any;
              vulnerabilities.push({
                id,
                severity: v.severity,
                description: v.overview,
                fixAvailable: !!v.fixAvailable,
                fixedIn: v.fixAvailable?.version,
                url: v.url
              });
            }
          } else if (this.detectedPackageManager === 'yarn') {
            // Yarn format
            for (const vuln of (auditResult.data?.vulnerabilities || [])) {
              vulnerabilities.push({
                id: vuln.advisory.id,
                severity: vuln.advisory.severity,
                description: vuln.advisory.title,
                fixAvailable: !!vuln.resolution,
                fixedIn: vuln.resolution?.version,
                url: vuln.advisory.url
              });
            }
          } else {
            // PNPM format
            for (const vuln of (auditResult.vulnerabilities || [])) {
              vulnerabilities.push({
                id: vuln.id,
                severity: vuln.severity,
                description: vuln.title,
                fixAvailable: !!vuln.fixAvailable,
                fixedIn: vuln.fixAvailable?.version,
                url: vuln.url
              });
            }
          }
          
          return vulnerabilities;
        }
      } catch (parseError) {
        console.error('Error parsing audit result:', parseError);
      }
      
      console.error('Error running security scan:', error);
      return [];
    }
  }
  
  private getDependencyAnalysisHtml(dependencies: DependencyInfo[]): string {
    // Count regular and dev dependencies
    const regularDeps = dependencies.filter(dep => !dep.isDev).length;
    const devDeps = dependencies.filter(dep => dep.isDev).length;
    
    // Count outdated dependencies
    const outdatedDeps = dependencies.filter(dep => dep.isOutdated).length;
    
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dependency Analysis</title>
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
          .outdated {
            color: var(--vscode-errorForeground);
          }
          .dev-dependency {
            font-style: italic;
            opacity: 0.8;
          }
        </style>
      </head>
      <body>
        <h1>Dependency Analysis</h1>
        
        <div class="summary">
          <div class="summary-item">
            <h3>Total Dependencies</h3>
            <p>${dependencies.length}</p>
          </div>
          <div class="summary-item">
            <h3>Regular Dependencies</h3>
            <p>${regularDeps}</p>
          </div>
          <div class="summary-item">
            <h3>Dev Dependencies</h3>
            <p>${devDeps}</p>
          </div>
          <div class="summary-item">
            <h3>Outdated Dependencies</h3>
            <p>${outdatedDeps}</p>
          </div>
        </div>
        
        <h2>Dependencies</h2>
        <table>
          <thead>
            <tr>
              <th>Package</th>
              <th>Current Version</th>
              <th>Latest Version</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            ${dependencies.map(dep => `
              <tr class="${dep.isOutdated ? 'outdated' : ''}">
                <td>${dep.name}</td>
                <td>${dep.version}</td>
                <td>${dep.latest || 'Up to date'}</td>
                <td class="${dep.isDev ? 'dev-dependency' : ''}">${dep.isDev ? 'Development' : 'Regular'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
  
  private getSecurityScanHtml(vulnerabilities: DependencyVulnerability[]): string {
    // Count vulnerabilities by severity
    const criticalCount = vulnerabilities.filter(v => v.severity === 'critical').length;
    const highCount = vulnerabilities.filter(v => v.severity === 'high').length;
    const moderateCount = vulnerabilities.filter(v => v.severity === 'moderate').length;
    const lowCount = vulnerabilities.filter(v => v.severity === 'low').length;
    
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Security Scan Results</title>
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
          .critical {
            background-color: rgba(255, 0, 0, 0.2);
          }
          .high {
            background-color: rgba(255, 165, 0, 0.2);
          }
          .moderate {
            background-color: rgba(255, 255, 0, 0.2);
          }
          .low {
            background-color: rgba(0, 0, 255, 0.2);
          }
          .vulnerability {
            margin-bottom: 20px;
            padding: 15px;
            border-radius: 5px;
          }
          .vulnerability h3 {
            margin-top: 0;
          }
          .vulnerability-critical {
            border-left: 5px solid red;
            background-color: rgba(255, 0, 0, 0.1);
          }
          .vulnerability-high {
            border-left: 5px solid orange;
            background-color: rgba(255, 165, 0, 0.1);
          }
          .vulnerability-moderate {
            border-left: 5px solid yellow;
            background-color: rgba(255, 255, 0, 0.1);
          }
          .vulnerability-low {
            border-left: 5px solid blue;
            background-color: rgba(0, 0, 255, 0.1);
          }
          .fix-available {
            color: green;
          }
          .fix-unavailable {
            color: red;
          }
        </style>
      </head>
      <body>
        <h1>Security Scan Results</h1>
        
        <div class="summary">
          <div class="summary-item critical">
            <h3>Critical</h3>
            <p>${criticalCount}</p>
          </div>
          <div class="summary-item high">
            <h3>High</h3>
            <p>${highCount}</p>
          </div>
          <div class="summary-item moderate">
            <h3>Moderate</h3>
            <p>${moderateCount}</p>
          </div>
          <div class="summary-item low">
            <h3>Low</h3>
            <p>${lowCount}</p>
          </div>
        </div>
        
        <h2>Vulnerabilities</h2>
        ${vulnerabilities.map(vuln => `
          <div class="vulnerability vulnerability-${vuln.severity}">
            <h3>${vuln.description}</h3>
            <p><strong>Severity:</strong> ${vuln.severity}</p>
            <p><strong>Fix:</strong> <span class="${vuln.fixAvailable ? 'fix-available' : 'fix-unavailable'}">${vuln.fixAvailable ? `Available (fixed in ${vuln.fixedIn})` : 'Not available'}</span></p>
            ${vuln.url ? `<p><a href="${vuln.url}" target="_blank">More information</a></p>` : ''}
          </div>
        `).join('')}
      </body>
      </html>
    `;
  }
  
  // Public methods
  public async suggestDependency(task: string): Promise<string[]> {
    // Suggest dependencies based on task description
    // This is a simplified version for demonstration purposes
    
    const suggestions: string[] = [];
    
    const taskLower = task.toLowerCase();
    
    if (taskLower.includes('react') || taskLower.includes('ui') || taskLower.includes('interface')) {
      suggestions.push('react', 'react-dom', '@types/react', '@types/react-dom');
    }
    
    if (taskLower.includes('test') || taskLower.includes('testing')) {
      suggestions.push('jest', '@types/jest', 'react-testing-library');
    }
    
    if (taskLower.includes('api') || taskLower.includes('http') || taskLower.includes('fetch')) {
      suggestions.push('axios', 'node-fetch');
    }
    
    if (taskLower.includes('style') || taskLower.includes('css')) {
      suggestions.push('styled-components', 'sass', 'tailwindcss');
    }
    
    if (taskLower.includes('state') || taskLower.includes('management')) {
      suggestions.push('redux', 'mobx', 'zustand');
    }
    
    return suggestions;
  }
  
  public async installSuggestedDependencies(dependencies: string[]): Promise<void> {
    if (!this.config.autoInstallDependencies) {
      // Ask for confirmation
      const confirmation = await vscode.window.showInformationMessage(
        `Install suggested dependencies: ${dependencies.join(', ')}?`,
        'Install',
        'Cancel'
      );
      
      if (confirmation !== 'Install') {
        return;
      }
    }
    
    // Install dependencies
    for (const dep of dependencies) {
      await this.runInstallCommand(dep, false);
    }
    
    vscode.window.showInformationMessage(`Installed dependencies: ${dependencies.join(', ')}`);
  }
  
  public async checkForVulnerabilities(): Promise<boolean> {
    if (!this.config.securityScanEnabled) {
      return false;
    }
    
    // Run security scan
    const vulnerabilities = await this.runSecurityScan();
    
    // Check for critical vulnerabilities
    const criticalVulnerabilities = vulnerabilities.filter(v => v.severity === 'critical');
    
    if (criticalVulnerabilities.length > 0) {
      const result = await vscode.window.showWarningMessage(
        `Found ${criticalVulnerabilities.length} critical security vulnerabilities in your dependencies`,
        'View Details',
        'Ignore'
      );
      
      if (result === 'View Details') {
        await this.securityScan();
      }
      
      return true;
    }
    
    return false;
  }
}
