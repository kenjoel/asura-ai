import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

// Types
export interface LearningConfig {
  enabled: boolean;
  dataPath: string;
  teamLearningEnabled: boolean;
  adaptationThreshold: number;
}

export interface UserPreference {
  id: string;
  category: string;
  name: string;
  value: any;
  confidence: number;
  lastUpdated: Date;
}

export interface CodePattern {
  id: string;
  pattern: string;
  language: string;
  frequency: number;
  lastSeen: Date;
}

export interface FeedbackItem {
  id: string;
  type: 'positive' | 'negative' | 'neutral';
  source: 'explicit' | 'implicit';
  context: string;
  content: string;
  timestamp: Date;
}

// Main learning service
export class LearningService {
  private userPreferences: Map<string, UserPreference> = new Map();
  private codePatterns: Map<string, CodePattern> = new Map();
  private feedback: FeedbackItem[] = [];
  private initialized: boolean = false;
  
  constructor(
    private readonly config: LearningConfig,
    private readonly context: vscode.ExtensionContext
  ) {
    if (this.config.enabled) {
      this.initialize();
    }
  }
  
  private async initialize(): Promise<void> {
    try {
      // Load data from storage
      await this.loadData();
      
      // Register commands
      this.registerCommands();
      
      // Register event listeners
      this.registerEventListeners();
      
      this.initialized = true;
      console.log('Learning service initialized');
    } catch (error) {
      console.error('Failed to initialize learning service:', error);
      vscode.window.showErrorMessage(`Failed to initialize learning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async loadData(): Promise<void> {
    try {
      // Create data directory if it doesn't exist
      await fs.mkdir(this.config.dataPath, { recursive: true });
      
      // Load user preferences
      const preferencesPath = path.join(this.config.dataPath, 'preferences.json');
      try {
        const preferencesData = await fs.readFile(preferencesPath, 'utf-8');
        const preferences = JSON.parse(preferencesData) as UserPreference[];
        
        for (const preference of preferences) {
          this.userPreferences.set(preference.id, preference);
        }
        
        console.log(`Loaded ${preferences.length} user preferences`);
      } catch (error) {
        // File might not exist yet, that's okay
        console.log('No user preferences found, starting with empty set');
      }
      
      // Load code patterns
      const patternsPath = path.join(this.config.dataPath, 'patterns.json');
      try {
        const patternsData = await fs.readFile(patternsPath, 'utf-8');
        const patterns = JSON.parse(patternsData) as CodePattern[];
        
        for (const pattern of patterns) {
          this.codePatterns.set(pattern.id, pattern);
        }
        
        console.log(`Loaded ${patterns.length} code patterns`);
      } catch (error) {
        // File might not exist yet, that's okay
        console.log('No code patterns found, starting with empty set');
      }
      
      // Load feedback
      const feedbackPath = path.join(this.config.dataPath, 'feedback.json');
      try {
        const feedbackData = await fs.readFile(feedbackPath, 'utf-8');
        this.feedback = JSON.parse(feedbackData) as FeedbackItem[];
        
        console.log(`Loaded ${this.feedback.length} feedback items`);
      } catch (error) {
        // File might not exist yet, that's okay
        console.log('No feedback found, starting with empty set');
      }
    } catch (error) {
      console.error('Error loading learning data:', error);
      throw new Error(`Failed to load learning data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async saveData(): Promise<void> {
    try {
      // Create data directory if it doesn't exist
      await fs.mkdir(this.config.dataPath, { recursive: true });
      
      // Save user preferences
      const preferencesPath = path.join(this.config.dataPath, 'preferences.json');
      const preferences = Array.from(this.userPreferences.values());
      await fs.writeFile(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');
      
      // Save code patterns
      const patternsPath = path.join(this.config.dataPath, 'patterns.json');
      const patterns = Array.from(this.codePatterns.values());
      await fs.writeFile(patternsPath, JSON.stringify(patterns, null, 2), 'utf-8');
      
      // Save feedback
      const feedbackPath = path.join(this.config.dataPath, 'feedback.json');
      await fs.writeFile(feedbackPath, JSON.stringify(this.feedback, null, 2), 'utf-8');
      
      console.log('Learning data saved');
    } catch (error) {
      console.error('Error saving learning data:', error);
      vscode.window.showErrorMessage(`Failed to save learning data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private registerCommands(): void {
    // Register commands for learning features
    this.context.subscriptions.push(
      vscode.commands.registerCommand('asura-ai.provideFeedback', this.provideFeedback.bind(this)),
      vscode.commands.registerCommand('asura-ai.resetLearning', this.resetLearning.bind(this)),
      vscode.commands.registerCommand('asura-ai.exportLearningData', this.exportLearningData.bind(this)),
      vscode.commands.registerCommand('asura-ai.importLearningData', this.importLearningData.bind(this))
    );
  }
  
  private registerEventListeners(): void {
    // Listen for document changes to learn code patterns
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(this.handleDocumentChange.bind(this)),
      vscode.workspace.onDidSaveTextDocument(this.handleDocumentSave.bind(this))
    );
  }
  
  // Command handlers
  private async provideFeedback(): Promise<void> {
    try {
      // Get feedback type
      const feedbackType = await vscode.window.showQuickPick(
        ['Positive', 'Negative', 'Neutral'],
        { placeHolder: 'Select feedback type' }
      );
      
      if (!feedbackType) {
        return;
      }
      
      // Get feedback content
      const feedbackContent = await vscode.window.showInputBox({
        prompt: 'Provide your feedback',
        placeHolder: 'What did you like or dislike about the assistant?'
      });
      
      if (!feedbackContent) {
        return;
      }
      
      // Create feedback item
      const feedbackItem: FeedbackItem = {
        id: this.generateId(),
        type: feedbackType.toLowerCase() as 'positive' | 'negative' | 'neutral',
        source: 'explicit',
        context: this.getCurrentContext(),
        content: feedbackContent,
        timestamp: new Date()
      };
      
      // Add feedback
      this.addFeedback(feedbackItem);
      
      vscode.window.showInformationMessage('Thank you for your feedback!');
    } catch (error) {
      console.error('Error providing feedback:', error);
      vscode.window.showErrorMessage(`Failed to provide feedback: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async resetLearning(): Promise<void> {
    try {
      // Confirm reset
      const confirmation = await vscode.window.showWarningMessage(
        'Are you sure you want to reset all learning data? This cannot be undone.',
        { modal: true },
        'Reset'
      );
      
      if (confirmation !== 'Reset') {
        return;
      }
      
      // Clear data
      this.userPreferences.clear();
      this.codePatterns.clear();
      this.feedback = [];
      
      // Save empty data
      await this.saveData();
      
      vscode.window.showInformationMessage('Learning data has been reset');
    } catch (error) {
      console.error('Error resetting learning data:', error);
      vscode.window.showErrorMessage(`Failed to reset learning data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async exportLearningData(): Promise<void> {
    try {
      // Get export path
      const exportUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('asura-learning-data.json'),
        filters: {
          'JSON Files': ['json']
        }
      });
      
      if (!exportUri) {
        return;
      }
      
      // Prepare export data
      const exportData = {
        preferences: Array.from(this.userPreferences.values()),
        patterns: Array.from(this.codePatterns.values()),
        feedback: this.feedback
      };
      
      // Write to file
      await fs.writeFile(exportUri.fsPath, JSON.stringify(exportData, null, 2), 'utf-8');
      
      vscode.window.showInformationMessage(`Learning data exported to ${exportUri.fsPath}`);
    } catch (error) {
      console.error('Error exporting learning data:', error);
      vscode.window.showErrorMessage(`Failed to export learning data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async importLearningData(): Promise<void> {
    try {
      // Get import path
      const importUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          'JSON Files': ['json']
        }
      });
      
      if (!importUri || importUri.length === 0) {
        return;
      }
      
      // Read file
      const importData = await fs.readFile(importUri[0].fsPath, 'utf-8');
      const data = JSON.parse(importData);
      
      // Validate data
      if (!data.preferences || !data.patterns || !data.feedback) {
        throw new Error('Invalid learning data format');
      }
      
      // Confirm import
      const confirmation = await vscode.window.showWarningMessage(
        'Importing learning data will replace your current data. Continue?',
        { modal: true },
        'Import'
      );
      
      if (confirmation !== 'Import') {
        return;
      }
      
      // Import data
      this.userPreferences.clear();
      for (const preference of data.preferences) {
        this.userPreferences.set(preference.id, preference);
      }
      
      this.codePatterns.clear();
      for (const pattern of data.patterns) {
        this.codePatterns.set(pattern.id, pattern);
      }
      
      this.feedback = data.feedback;
      
      // Save imported data
      await this.saveData();
      
      vscode.window.showInformationMessage('Learning data imported successfully');
    } catch (error) {
      console.error('Error importing learning data:', error);
      vscode.window.showErrorMessage(`Failed to import learning data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Event handlers
  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (!this.config.enabled || !this.initialized) {
      return;
    }
    
    // Only process code files
    if (!this.isCodeFile(event.document)) {
      return;
    }
    
    // Extract patterns from changes
    for (const change of event.contentChanges) {
      this.extractPatternsFromChange(event.document, change);
    }
  }
  
  private handleDocumentSave(document: vscode.TextDocument): void {
    if (!this.config.enabled || !this.initialized) {
      return;
    }
    
    // Only process code files
    if (!this.isCodeFile(document)) {
      return;
    }
    
    // Extract patterns from entire document
    this.extractPatternsFromDocument(document);
    
    // Save data periodically
    this.saveData();
  }
  
  // Helper methods
  private isCodeFile(document: vscode.TextDocument): boolean {
    // Check if the file is a code file based on language ID
    const languageId = document.languageId.toLowerCase();
    return [
      'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
      'python', 'java', 'c', 'cpp', 'csharp', 'go', 'ruby', 'php', 'swift',
      'kotlin', 'rust', 'dart'
    ].includes(languageId);
  }
  
  private extractPatternsFromChange(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent): void {
    // In a real implementation, this would use more sophisticated pattern recognition
    // For this demo, we'll use a simple approach
    
    const text = change.text;
    const languageId = document.languageId;
    
    // Skip if the change is too small
    if (text.length < 5) {
      return;
    }
    
    // Extract simple patterns
    this.extractSimplePatterns(text, languageId);
  }
  
  private extractPatternsFromDocument(document: vscode.TextDocument): void {
    // In a real implementation, this would use more sophisticated pattern recognition
    // For this demo, we'll use a simple approach
    
    const text = document.getText();
    const languageId = document.languageId;
    
    // Extract simple patterns
    this.extractSimplePatterns(text, languageId);
  }
  
  private extractSimplePatterns(text: string, languageId: string): void {
    // Simple pattern extraction based on common coding constructs
    // This is a simplified version for demonstration purposes
    
    // Extract function declarations
    const functionRegex = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match;
    
    while ((match = functionRegex.exec(text)) !== null) {
      const pattern = `function ${match[1]}`;
      this.addOrUpdateCodePattern(pattern, languageId);
    }
    
    // Extract variable declarations
    const varRegex = /(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;
    
    while ((match = varRegex.exec(text)) !== null) {
      const pattern = `${match[1]} ${match[2]}`;
      this.addOrUpdateCodePattern(pattern, languageId);
    }
    
    // Extract import statements (for JS/TS)
    if (languageId.includes('javascript') || languageId.includes('typescript')) {
      const importRegex = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
      
      while ((match = importRegex.exec(text)) !== null) {
        const pattern = `import from ${match[1]}`;
        this.addOrUpdateCodePattern(pattern, languageId);
      }
    }
  }
  
  private addOrUpdateCodePattern(pattern: string, language: string): void {
    // Generate a consistent ID for the pattern
    const id = this.hashString(`${pattern}:${language}`);
    
    // Check if pattern already exists
    const existingPattern = this.codePatterns.get(id);
    
    if (existingPattern) {
      // Update existing pattern
      existingPattern.frequency += 1;
      existingPattern.lastSeen = new Date();
      this.codePatterns.set(id, existingPattern);
    } else {
      // Add new pattern
      const newPattern: CodePattern = {
        id,
        pattern,
        language,
        frequency: 1,
        lastSeen: new Date()
      };
      
      this.codePatterns.set(id, newPattern);
    }
  }
  
  private addFeedback(feedback: FeedbackItem): void {
    // Add feedback to list
    this.feedback.push(feedback);
    
    // Save data
    this.saveData();
    
    // Update preferences based on feedback
    this.updatePreferencesFromFeedback(feedback);
  }
  
  private updatePreferencesFromFeedback(feedback: FeedbackItem): void {
    // In a real implementation, this would use more sophisticated analysis
    // For this demo, we'll use a simple approach
    
    // Extract preferences from feedback content
    if (feedback.content.includes('code style')) {
      this.updatePreference('code-style', 'formatting', feedback.type === 'positive');
    }
    
    if (feedback.content.includes('explanation')) {
      this.updatePreference('communication', 'explanation-detail', feedback.type === 'positive');
    }
    
    if (feedback.content.includes('suggestion')) {
      this.updatePreference('assistance', 'suggestion-frequency', feedback.type === 'positive');
    }
  }
  
  private updatePreference(category: string, name: string, isPositive: boolean): void {
    // Generate a consistent ID for the preference
    const id = this.hashString(`${category}:${name}`);
    
    // Check if preference already exists
    const existingPreference = this.userPreferences.get(id);
    
    if (existingPreference) {
      // Update existing preference
      if (isPositive) {
        existingPreference.value = Math.min(1.0, existingPreference.value + 0.1);
        existingPreference.confidence = Math.min(1.0, existingPreference.confidence + 0.05);
      } else {
        existingPreference.value = Math.max(0.0, existingPreference.value - 0.1);
        existingPreference.confidence = Math.min(1.0, existingPreference.confidence + 0.05);
      }
      
      existingPreference.lastUpdated = new Date();
      this.userPreferences.set(id, existingPreference);
    } else {
      // Add new preference
      const newPreference: UserPreference = {
        id,
        category,
        name,
        value: isPositive ? 0.6 : 0.4,
        confidence: 0.1,
        lastUpdated: new Date()
      };
      
      this.userPreferences.set(id, newPreference);
    }
  }
  
  private getCurrentContext(): string {
    // In a real implementation, this would capture the current context
    // For this demo, we'll return a simple placeholder
    return 'current-context';
  }
  
  private generateId(): string {
    // Generate a random ID
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
  
  private hashString(str: string): string {
    // Simple hash function for generating IDs
    let hash = 0;
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return Math.abs(hash).toString(16);
  }
  
  // Public methods
  public getPreference(category: string, name: string, defaultValue: any = 0.5): any {
    // Generate a consistent ID for the preference
    const id = this.hashString(`${category}:${name}`);
    
    // Check if preference exists
    const preference = this.userPreferences.get(id);
    
    if (preference && preference.confidence > this.config.adaptationThreshold) {
      return preference.value;
    }
    
    return defaultValue;
  }
  
  public getCodePatterns(language: string, limit: number = 10): CodePattern[] {
    // Get patterns for the specified language
    const patterns = Array.from(this.codePatterns.values())
      .filter(pattern => pattern.language === language)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
    
    return patterns;
  }
  
  public getTopPreferences(limit: number = 10): UserPreference[] {
    // Get top preferences by confidence
    const preferences = Array.from(this.userPreferences.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
    
    return preferences;
  }
  
  public recordImplicitFeedback(type: 'positive' | 'negative' | 'neutral', context: string, content: string): void {
    // Create feedback item
    const feedbackItem: FeedbackItem = {
      id: this.generateId(),
      type,
      source: 'implicit',
      context,
      content,
      timestamp: new Date()
    };
    
    // Add feedback
    this.addFeedback(feedbackItem);
  }
}
