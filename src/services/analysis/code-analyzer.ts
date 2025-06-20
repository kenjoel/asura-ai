import * as path from 'path';
import { Worker } from 'worker_threads';

// Types
interface AnalysisTask {
  filePath: string;
  content: string;
  timestamp: number;
  priority: number;
}

interface AnalysisResult {
  filePath: string;
  issues: AnalysisIssue[];
}

interface AnalysisIssue {
  type: string;
  message: string;
  line: number;
  column: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  confidence: number;
  suggestedFix?: string;
}

interface AnalysisRule {
  id: string;
  name: string;
  description: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  fileTypes: string[];
}

interface IssueNotifier {
  notifyIssues: (filePath: string, issues: AnalysisIssue[]) => void;
}

// Worker script content for analysis
const workerScript = `
const { parentPort } = require('worker_threads');

// Simple rules for code analysis
const rules = {
  'no-console': {
    check: (content) => {
      const regex = /console\\.(log|warn|error|info|debug)/g;
      const matches = [...content.matchAll(regex)];
      return matches.map(match => ({
        type: 'no-console',
        message: 'Avoid using console statements in production code',
        line: getLineNumber(content, match.index),
        column: getColumnNumber(content, match.index),
        severity: 'warning',
        confidence: 0.9,
        suggestedFix: 'Replace with proper logging mechanism'
      }));
    }
  },
  'no-unused-vars': {
    check: (content) => {
      // This is a simplified version - a real implementation would use AST parsing
      const declaredVars = [];
      const usedVars = [];
      
      // Find declared variables
      const declRegex = /(?:const|let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*(?:=|;)/g;
      let match;
      while ((match = declRegex.exec(content)) !== null) {
        declaredVars.push({
          name: match[1],
          index: match.index
        });
      }
      
      // Find used variables
      const contentWithoutDeclarations = content.replace(declRegex, '');
      for (const varInfo of declaredVars) {
        const usageRegex = new RegExp(\`[^a-zA-Z0-9_$]\${varInfo.name}[^a-zA-Z0-9_$]\`, 'g');
        if (usageRegex.test(contentWithoutDeclarations)) {
          usedVars.push(varInfo.name);
        }
      }
      
      // Find unused variables
      return declaredVars
        .filter(varInfo => !usedVars.includes(varInfo.name))
        .map(varInfo => ({
          type: 'no-unused-vars',
          message: \`Variable '\${varInfo.name}' is declared but never used\`,
          line: getLineNumber(content, varInfo.index),
          column: getColumnNumber(content, varInfo.index),
          severity: 'warning',
          confidence: 0.7,
          suggestedFix: \`Remove the unused variable '\${varInfo.name}'\`
        }));
    }
  },
  'no-empty-catch': {
    check: (content) => {
      const regex = /catch\\s*\\([^)]*\\)\\s*{\\s*}/g;
      const matches = [...content.matchAll(regex)];
      return matches.map(match => ({
        type: 'no-empty-catch',
        message: 'Empty catch block detected',
        line: getLineNumber(content, match.index),
        column: getColumnNumber(content, match.index),
        severity: 'error',
        confidence: 0.95,
        suggestedFix: 'Add error handling or logging in the catch block'
      }));
    }
  },
  'security-eval': {
    check: (content) => {
      const regex = /eval\\s*\\(/g;
      const matches = [...content.matchAll(regex)];
      return matches.map(match => ({
        type: 'security-eval',
        message: 'Avoid using eval() as it can lead to security vulnerabilities',
        line: getLineNumber(content, match.index),
        column: getColumnNumber(content, match.index),
        severity: 'critical',
        confidence: 0.95,
        suggestedFix: 'Replace eval() with safer alternatives'
      }));
    }
  }
};

// Helper functions
function getLineNumber(content, index) {
  const lines = content.substring(0, index).split('\\n');
  return lines.length;
}

function getColumnNumber(content, index) {
  const lines = content.substring(0, index).split('\\n');
  return index - content.lastIndexOf('\\n', index);
}

// Listen for messages from the main thread
parentPort.on('message', (message) => {
  if (message.type === 'analyze') {
    const { filePath, content, rules: ruleIds } = message;
    
    // Run analysis with specified rules
    const issues = [];
    
    // If specific rules are provided, use only those
    const rulesToUse = ruleIds && ruleIds.length > 0
      ? ruleIds.map(id => rules[id]).filter(Boolean)
      : Object.values(rules);
    
    // Apply each rule
    for (const rule of rulesToUse) {
      const ruleIssues = rule.check(content);
      issues.push(...ruleIssues);
    }
    
    // Send results back to main thread
    parentPort.postMessage({
      filePath,
      issues
    });
  }
});
`;

export class CodeAnalyzer {
  private worker: Worker | null = null;
  private analysisQueue: AnalysisTask[] = [];
  private isAnalyzing: boolean = false;
  
  constructor(private readonly notifier: IssueNotifier) {
    // Create worker script file
    this.initializeWorker();
  }
  
  private async initializeWorker() {
    try {
      // In a real implementation, we would create a worker from a file
      // For this demo, we'll create a worker from a string
      const workerData = { script: workerScript };
      
      // Create a worker
      this.worker = new Worker(
        `
        const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
        
        if (isMainThread) {
          module.exports = new Worker(__filename, { workerData });
        } else {
          eval(workerData.script);
        }
        `,
        { eval: true, workerData }
      );
      
      // Handle analysis results from worker
      this.worker.on('message', (result: AnalysisResult) => {
        this.handleAnalysisResult(result);
      });
      
      // Handle worker errors
      this.worker.on('error', (error) => {
        console.error('Analysis worker error:', error);
        // Restart worker if it crashes
        this.worker = null;
        this.initializeWorker();
      });
    } catch (error) {
      console.error('Failed to initialize analysis worker:', error);
    }
  }
  
  async scheduleAnalysis(filePath: string, content: string): Promise<void> {
    // Add to queue or update existing task
    const existingTaskIndex = this.analysisQueue.findIndex(t => t.filePath === filePath);
    
    if (existingTaskIndex >= 0) {
      // Update existing task with new content
      this.analysisQueue[existingTaskIndex].content = content;
      this.analysisQueue[existingTaskIndex].timestamp = Date.now();
    } else {
      // Add new task
      this.analysisQueue.push({
        filePath,
        content,
        timestamp: Date.now(),
        priority: this.calculatePriority(filePath, content)
      });
    }
    
    // Sort queue by priority
    this.analysisQueue.sort((a, b) => b.priority - a.priority);
    
    // Start processing if not already running
    if (!this.isAnalyzing) {
      this.processNextTask();
    }
  }
  
  private async processNextTask(): Promise<void> {
    if (this.analysisQueue.length === 0) {
      this.isAnalyzing = false;
      return;
    }
    
    this.isAnalyzing = true;
    const task = this.analysisQueue.shift();
    
    if (!task) {
      this.isAnalyzing = false;
      return;
    }
    
    // Ensure worker is initialized
    if (!this.worker) {
      await this.initializeWorker();
      if (!this.worker) {
        console.error('Failed to initialize worker for analysis');
        this.isAnalyzing = false;
        return;
      }
    }
    
    // Send task to worker
    this.worker.postMessage({
      type: 'analyze',
      filePath: task.filePath,
      content: task.content,
      rules: this.getRulesForFile(task.filePath)
    });
  }
  
  private handleAnalysisResult(result: AnalysisResult): void {
    // Process issues found by analysis
    if (result.issues.length > 0) {
      // Filter out low-confidence or low-severity issues
      const significantIssues = result.issues.filter(
        issue => issue.confidence > 0.7 || issue.severity === 'critical'
      );
      
      if (significantIssues.length > 0) {
        // Notify user of issues
        this.notifier.notifyIssues(result.filePath, significantIssues);
      }
    }
    
    // Process next task
    this.processNextTask();
  }
  
  private calculatePriority(filePath: string, content: string): number {
    // Calculate priority based on file type, size, and recent changes
    let priority = 1;
    
    // Higher priority for certain file types
    const ext = path.extname(filePath).toLowerCase();
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      priority += 2;
    }
    
    // Higher priority for smaller files (faster to analyze)
    if (content.length < 5000) {
      priority += 1;
    }
    
    // Higher priority for files with potential security issues
    if (content.includes('eval(') || content.includes('dangerouslySetInnerHTML')) {
      priority += 3;
    }
    
    return priority;
  }
  
  private getRulesForFile(filePath: string): string[] {
    // Get appropriate analysis rules based on file type
    const ext = path.extname(filePath).toLowerCase();
    
    // Base rules for all files
    const rules = ['security-eval', 'no-empty-catch'];
    
    // Add language-specific rules
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      rules.push('no-console', 'no-unused-vars');
    }
    
    return rules;
  }
}
