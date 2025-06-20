import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SecurityService } from './index';

// Security vulnerability types
export enum VulnerabilityType {
  SQL_INJECTION = 'SQL_INJECTION',
  XSS = 'XSS',
  HARDCODED_SECRETS = 'HARDCODED_SECRETS',
  INSECURE_CRYPTO = 'INSECURE_CRYPTO',
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  COMMAND_INJECTION = 'COMMAND_INJECTION',
  WEAK_AUTHENTICATION = 'WEAK_AUTHENTICATION',
  INSECURE_DESERIALIZATION = 'INSECURE_DESERIALIZATION',
  UNSAFE_EVAL = 'UNSAFE_EVAL',
  MISSING_VALIDATION = 'MISSING_VALIDATION',
  INSECURE_RANDOM = 'INSECURE_RANDOM',
  BUFFER_OVERFLOW = 'BUFFER_OVERFLOW',
  RACE_CONDITION = 'RACE_CONDITION',
  PRIVILEGE_ESCALATION = 'PRIVILEGE_ESCALATION',
  INFORMATION_DISCLOSURE = 'INFORMATION_DISCLOSURE'
}

export enum SeverityLevel {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO'
}

export interface SecurityVulnerability {
  id: string;
  type: VulnerabilityType;
  severity: SeverityLevel;
  title: string;
  description: string;
  file: string;
  line: number;
  column: number;
  code: string;
  suggestion: string;
  cweId?: string;
  cvssScore?: number;
  references?: string[];
}

export interface SecurityScanResult {
  scanId: string;
  timestamp: Date;
  filesScanned: number;
  vulnerabilities: SecurityVulnerability[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

export interface SecurityRule {
  id: string;
  name: string;
  type: VulnerabilityType;
  severity: SeverityLevel;
  pattern: RegExp;
  languages: string[];
  description: string;
  suggestion: string;
  cweId?: string;
  enabled: boolean;
}

// Real-time security scanner
export class CodeSecurityScanner {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private securityRules: SecurityRule[] = [];
  private realtimeEnabled: boolean = true;
  private scanOnSave: boolean = true;
  private scanOnCommit: boolean = true;
  
  constructor(
    private readonly securityService: SecurityService,
    private readonly context: vscode.ExtensionContext
  ) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('asura-security');
    this.initializeSecurityRules();
    this.setupEventListeners();
    this.registerCommands();
  }
  
  private initializeSecurityRules(): void {
    this.securityRules = [
      // SQL Injection patterns
      {
        id: 'sql-injection-1',
        name: 'SQL Injection - String Concatenation',
        type: VulnerabilityType.SQL_INJECTION,
        severity: SeverityLevel.HIGH,
        pattern: /(?:query|sql|execute)\s*\(\s*["'`][^"'`]*\+[^"'`]*["'`]/gi,
        languages: ['javascript', 'typescript', 'python', 'java', 'csharp'],
        description: 'SQL query uses string concatenation which may lead to SQL injection',
        suggestion: 'Use parameterized queries or prepared statements instead',
        cweId: 'CWE-89',
        enabled: true
      },
      
      // XSS patterns
      {
        id: 'xss-1',
        name: 'XSS - innerHTML with user input',
        type: VulnerabilityType.XSS,
        severity: SeverityLevel.HIGH,
        pattern: /\.innerHTML\s*=\s*(?!["'`])[^;]+/gi,
        languages: ['javascript', 'typescript'],
        description: 'Setting innerHTML with dynamic content may lead to XSS',
        suggestion: 'Use textContent or sanitize the input before setting innerHTML',
        cweId: 'CWE-79',
        enabled: true
      },
      
      // Hardcoded secrets
      {
        id: 'secrets-1',
        name: 'Hardcoded API Key',
        type: VulnerabilityType.HARDCODED_SECRETS,
        severity: SeverityLevel.CRITICAL,
        pattern: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'`][a-zA-Z0-9]{20,}["'`]/gi,
        languages: ['javascript', 'typescript', 'python', 'java', 'csharp', 'go', 'rust'],
        description: 'Hardcoded API key or secret detected',
        suggestion: 'Move secrets to environment variables or secure configuration',
        cweId: 'CWE-798',
        enabled: true
      },
      
      // Insecure crypto
      {
        id: 'crypto-1',
        name: 'Weak Cryptographic Algorithm',
        type: VulnerabilityType.INSECURE_CRYPTO,
        severity: SeverityLevel.HIGH,
        pattern: /(?:md5|sha1|des|rc4)\s*\(/gi,
        languages: ['javascript', 'typescript', 'python', 'java', 'csharp'],
        description: 'Weak cryptographic algorithm detected',
        suggestion: 'Use strong algorithms like SHA-256, AES-256, or bcrypt',
        cweId: 'CWE-327',
        enabled: true
      },
      
      // Path traversal
      {
        id: 'path-traversal-1',
        name: 'Path Traversal',
        type: VulnerabilityType.PATH_TRAVERSAL,
        severity: SeverityLevel.HIGH,
        pattern: /(?:readFile|writeFile|open)\s*\([^)]*\.\.[\/\\]/gi,
        languages: ['javascript', 'typescript', 'python', 'java', 'csharp'],
        description: 'Potential path traversal vulnerability detected',
        suggestion: 'Validate and sanitize file paths, use path.resolve() or similar',
        cweId: 'CWE-22',
        enabled: true
      },
      
      // Command injection
      {
        id: 'command-injection-1',
        name: 'Command Injection',
        type: VulnerabilityType.COMMAND_INJECTION,
        severity: SeverityLevel.CRITICAL,
        pattern: /(?:exec|system|shell_exec|eval)\s*\([^)]*\$[^)]*\)/gi,
        languages: ['javascript', 'typescript', 'python', 'php'],
        description: 'Potential command injection vulnerability',
        suggestion: 'Avoid executing user input, use safe alternatives or sanitize input',
        cweId: 'CWE-78',
        enabled: true
      },
      
      // Unsafe eval
      {
        id: 'unsafe-eval-1',
        name: 'Unsafe eval() usage',
        type: VulnerabilityType.UNSAFE_EVAL,
        severity: SeverityLevel.HIGH,
        pattern: /\beval\s*\(/gi,
        languages: ['javascript', 'typescript'],
        description: 'Use of eval() can lead to code injection',
        suggestion: 'Avoid eval(), use JSON.parse() for data or safer alternatives',
        cweId: 'CWE-95',
        enabled: true
      },
      
      // Weak random
      {
        id: 'weak-random-1',
        name: 'Weak Random Number Generation',
        type: VulnerabilityType.INSECURE_RANDOM,
        severity: SeverityLevel.MEDIUM,
        pattern: /Math\.random\(\)/gi,
        languages: ['javascript', 'typescript'],
        description: 'Math.random() is not cryptographically secure',
        suggestion: 'Use crypto.randomBytes() or crypto.getRandomValues() for security purposes',
        cweId: 'CWE-338',
        enabled: true
      },
      
      // Missing validation
      {
        id: 'validation-1',
        name: 'Missing Input Validation',
        type: VulnerabilityType.MISSING_VALIDATION,
        severity: SeverityLevel.MEDIUM,
        pattern: /(?:req\.body|req\.params|req\.query)\.[a-zA-Z_][a-zA-Z0-9_]*(?!\s*&&|\s*\|\||\s*\?|\s*===|\s*!==|\s*==|\s*!=|\s*>|\s*<|\s*>=|\s*<=)/gi,
        languages: ['javascript', 'typescript'],
        description: 'User input used without validation',
        suggestion: 'Validate and sanitize all user inputs before use',
        cweId: 'CWE-20',
        enabled: true
      },
      
      // Insecure deserialization
      {
        id: 'deserialization-1',
        name: 'Insecure Deserialization',
        type: VulnerabilityType.INSECURE_DESERIALIZATION,
        severity: SeverityLevel.HIGH,
        pattern: /(?:pickle\.loads|yaml\.load|unserialize)\s*\(/gi,
        languages: ['python', 'php'],
        description: 'Insecure deserialization can lead to remote code execution',
        suggestion: 'Use safe deserialization methods or validate data before deserializing',
        cweId: 'CWE-502',
        enabled: true
      }
    ];
  }
  
  private setupEventListeners(): void {
    // Real-time scanning on document change
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (this.realtimeEnabled && this.isSecurityRelevantFile(event.document.fileName)) {
        await this.scanDocument(event.document);
      }
    });
    
    // Scan on save
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (this.scanOnSave && this.isSecurityRelevantFile(document.fileName)) {
        await this.scanDocument(document);
      }
    });
    
    // Scan on commit (Git pre-commit hook simulation)
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('git') && this.scanOnCommit) {
        this.scanWorkspaceForCommit();
      }
    });
  }
  
  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('asura-ai.scanSecurity', this.scanWorkspace.bind(this)),
      vscode.commands.registerCommand('asura-ai.scanCurrentFile', this.scanCurrentFile.bind(this)),
      vscode.commands.registerCommand('asura-ai.toggleRealtimeScan', this.toggleRealtimeScan.bind(this)),
      vscode.commands.registerCommand('asura-ai.showSecurityReport', this.showSecurityReport.bind(this)),
      vscode.commands.registerCommand('asura-ai.fixSecurityIssue', this.fixSecurityIssue.bind(this))
    );
  }
  
  private isSecurityRelevantFile(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    const relevantExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.php', '.go', '.rs', '.cpp', '.c'];
    return relevantExtensions.includes(ext);
  }
  
  public async scanDocument(document: vscode.TextDocument): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];
    const text = document.getText();
    const lines = text.split('\n');
    const language = document.languageId;
    
    // Apply security rules
    for (const rule of this.securityRules) {
      if (!rule.enabled || !rule.languages.includes(language)) {
        continue;
      }
      
      let match;
      while ((match = rule.pattern.exec(text)) !== null) {
        const position = document.positionAt(match.index);
        const line = lines[position.line];
        
        const vulnerability: SecurityVulnerability = {
          id: `${rule.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: rule.type,
          severity: rule.severity,
          title: rule.name,
          description: rule.description,
          file: document.fileName,
          line: position.line + 1,
          column: position.character + 1,
          code: line.trim(),
          suggestion: rule.suggestion,
          cweId: rule.cweId
        };
        
        vulnerabilities.push(vulnerability);
      }
      
      // Reset regex lastIndex to avoid issues with global flag
      rule.pattern.lastIndex = 0;
    }
    
    // Update diagnostics
    this.updateDiagnostics(document, vulnerabilities);
    
    return vulnerabilities;
  }
  
  private updateDiagnostics(document: vscode.TextDocument, vulnerabilities: SecurityVulnerability[]): void {
    const diagnostics: vscode.Diagnostic[] = vulnerabilities.map(vuln => {
      const range = new vscode.Range(
        vuln.line - 1,
        vuln.column - 1,
        vuln.line - 1,
        vuln.column + vuln.code.length
      );
      
      const diagnostic = new vscode.Diagnostic(
        range,
        `${vuln.title}: ${vuln.description}`,
        this.getSeverityLevel(vuln.severity)
      );
      
      diagnostic.code = vuln.cweId;
      diagnostic.source = 'Asura Security';
      
      return diagnostic;
    });
    
    this.diagnosticCollection.set(document.uri, diagnostics);
  }
  
  private getSeverityLevel(severity: SeverityLevel): vscode.DiagnosticSeverity {
    switch (severity) {
      case SeverityLevel.CRITICAL:
      case SeverityLevel.HIGH:
        return vscode.DiagnosticSeverity.Error;
      case SeverityLevel.MEDIUM:
        return vscode.DiagnosticSeverity.Warning;
      case SeverityLevel.LOW:
      case SeverityLevel.INFO:
        return vscode.DiagnosticSeverity.Information;
      default:
        return vscode.DiagnosticSeverity.Warning;
    }
  }
  
  public async scanWorkspace(): Promise<SecurityScanResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      throw new Error('No workspace folder found');
    }
    
    const allVulnerabilities: SecurityVulnerability[] = [];
    let filesScanned = 0;
    
    for (const folder of workspaceFolders) {
      const files = await this.getSecurityRelevantFiles(folder.uri.fsPath);
      
      for (const file of files) {
        try {
          const document = await vscode.workspace.openTextDocument(file);
          const vulnerabilities = await this.scanDocument(document);
          allVulnerabilities.push(...vulnerabilities);
          filesScanned++;
        } catch (error) {
          console.error(`Error scanning file ${file}:`, error);
        }
      }
    }
    
    const summary = this.createSummary(allVulnerabilities);
    
    const result: SecurityScanResult = {
      scanId: `scan-${Date.now()}`,
      timestamp: new Date(),
      filesScanned,
      vulnerabilities: allVulnerabilities,
      summary
    };
    
    // Log security scan
    await this.securityService.logAudit(
      'INFO' as any,
      'security.workspaceScan',
      undefined,
      undefined,
      { filesScanned, vulnerabilitiesFound: allVulnerabilities.length },
      true
    );
    
    return result;
  }
  
  private async getSecurityRelevantFiles(folderPath: string): Promise<string[]> {
    const files: string[] = [];
    
    const scanDirectory = async (dirPath: string) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory()) {
            // Skip node_modules and other irrelevant directories
            if (!['node_modules', '.git', 'dist', 'build', 'out'].includes(entry.name)) {
              await scanDirectory(fullPath);
            }
          } else if (entry.isFile() && this.isSecurityRelevantFile(entry.name)) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error);
      }
    };
    
    await scanDirectory(folderPath);
    return files;
  }
  
  private createSummary(vulnerabilities: SecurityVulnerability[]) {
    return {
      critical: vulnerabilities.filter(v => v.severity === SeverityLevel.CRITICAL).length,
      high: vulnerabilities.filter(v => v.severity === SeverityLevel.HIGH).length,
      medium: vulnerabilities.filter(v => v.severity === SeverityLevel.MEDIUM).length,
      low: vulnerabilities.filter(v => v.severity === SeverityLevel.LOW).length,
      info: vulnerabilities.filter(v => v.severity === SeverityLevel.INFO).length
    };
  }
  
  // Command handlers
  private async scanCurrentFile(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showInformationMessage('No active file to scan');
      return;
    }
    
    const vulnerabilities = await this.scanDocument(activeEditor.document);
    
    if (vulnerabilities.length === 0) {
      vscode.window.showInformationMessage('No security issues found in current file');
    } else {
      vscode.window.showWarningMessage(`Found ${vulnerabilities.length} security issue(s) in current file`);
    }
  }
  
  private toggleRealtimeScan(): void {
    this.realtimeEnabled = !this.realtimeEnabled;
    const status = this.realtimeEnabled ? 'enabled' : 'disabled';
    vscode.window.showInformationMessage(`Real-time security scanning ${status}`);
  }
  
  private async showSecurityReport(): Promise<void> {
    const result = await this.scanWorkspace();
    
    const panel = vscode.window.createWebviewPanel(
      'securityReport',
      'Security Scan Report',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    
    panel.webview.html = this.generateSecurityReportHtml(result);
  }
  
  private generateSecurityReportHtml(result: SecurityScanResult): string {
    const criticalIssues = result.vulnerabilities.filter(v => v.severity === SeverityLevel.CRITICAL);
    const highIssues = result.vulnerabilities.filter(v => v.severity === SeverityLevel.HIGH);
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Security Scan Report</title>
        <style>
          body { font-family: var(--vscode-font-family); padding: 20px; }
          .summary { display: flex; gap: 20px; margin-bottom: 30px; }
          .summary-card { padding: 15px; border-radius: 8px; text-align: center; min-width: 100px; }
          .critical { background-color: rgba(255, 0, 0, 0.2); }
          .high { background-color: rgba(255, 165, 0, 0.2); }
          .medium { background-color: rgba(255, 255, 0, 0.2); }
          .low { background-color: rgba(0, 255, 0, 0.2); }
          .vulnerability { margin-bottom: 20px; padding: 15px; border-left: 4px solid; }
          .vuln-critical { border-color: #ff0000; }
          .vuln-high { border-color: #ffa500; }
          .vuln-medium { border-color: #ffff00; }
          .vuln-low { border-color: #00ff00; }
          .code { background-color: var(--vscode-editor-background); padding: 10px; border-radius: 4px; font-family: monospace; }
        </style>
      </head>
      <body>
        <h1>🔒 Security Scan Report</h1>
        <p><strong>Scan ID:</strong> ${result.scanId}</p>
        <p><strong>Timestamp:</strong> ${result.timestamp.toISOString()}</p>
        <p><strong>Files Scanned:</strong> ${result.filesScanned}</p>
        
        <div class="summary">
          <div class="summary-card critical">
            <h3>Critical</h3>
            <p>${result.summary.critical}</p>
          </div>
          <div class="summary-card high">
            <h3>High</h3>
            <p>${result.summary.high}</p>
          </div>
          <div class="summary-card medium">
            <h3>Medium</h3>
            <p>${result.summary.medium}</p>
          </div>
          <div class="summary-card low">
            <h3>Low</h3>
            <p>${result.summary.low}</p>
          </div>
        </div>
        
        <h2>Vulnerabilities</h2>
        ${result.vulnerabilities.map(vuln => `
          <div class="vulnerability vuln-${vuln.severity.toLowerCase()}">
            <h3>${vuln.title} (${vuln.severity})</h3>
            <p><strong>File:</strong> ${path.basename(vuln.file)}:${vuln.line}:${vuln.column}</p>
            <p><strong>Description:</strong> ${vuln.description}</p>
            <div class="code">${vuln.code}</div>
            <p><strong>Suggestion:</strong> ${vuln.suggestion}</p>
            ${vuln.cweId ? `<p><strong>CWE:</strong> ${vuln.cweId}</p>` : ''}
          </div>
        `).join('')}
      </body>
      </html>
    `;
  }
  
  private async fixSecurityIssue(vulnerability: SecurityVulnerability): Promise<void> {
    // AI-powered security fix suggestions
    const document = await vscode.workspace.openTextDocument(vulnerability.file);
    const editor = await vscode.window.showTextDocument(document);
    
    // Navigate to the vulnerability
    const position = new vscode.Position(vulnerability.line - 1, vulnerability.column - 1);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
    
    // Show quick fix options
    const action = await vscode.window.showQuickPick([
      'Apply AI-suggested fix',
      'Show fix documentation',
      'Ignore this issue',
      'Add to whitelist'
    ], {
      placeHolder: `Fix: ${vulnerability.title}`
    });
    
    if (action === 'Apply AI-suggested fix') {
      // This would integrate with the AI service to generate a fix
      vscode.window.showInformationMessage('AI fix generation coming soon!');
    }
  }
  
  private async scanWorkspaceForCommit(): Promise<void> {
    // Simulate pre-commit security scan
    const result = await this.scanWorkspace();
    const criticalAndHigh = result.vulnerabilities.filter(
      v => v.severity === SeverityLevel.CRITICAL || v.severity === SeverityLevel.HIGH
    );
    
    if (criticalAndHigh.length > 0) {
      const action = await vscode.window.showWarningMessage(
        `Found ${criticalAndHigh.length} critical/high security issues. Commit anyway?`,
        'View Issues',
        'Commit Anyway',
        'Cancel'
      );
      
      if (action === 'View Issues') {
        this.showSecurityReport();
      }
    }
  }
  
  // Public API
  public enableRealtimeScanning(): void {
    this.realtimeEnabled = true;
  }
  
  public disableRealtimeScanning(): void {
    this.realtimeEnabled = false;
  }
  
  public addCustomRule(rule: SecurityRule): void {
    this.securityRules.push(rule);
  }
  
  public removeRule(ruleId: string): void {
    this.securityRules = this.securityRules.filter(rule => rule.id !== ruleId);
  }
  
  public getVulnerabilities(): SecurityVulnerability[] {
    const allDiagnostics: SecurityVulnerability[] = [];
    this.diagnosticCollection.forEach((_uri, _diagnostics) => {
      // Convert diagnostics back to vulnerabilities if needed
      // This would require storing vulnerability data separately
    });
    return allDiagnostics;
  }
}
