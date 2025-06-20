import * as vscode from 'vscode';
import * as crypto from 'crypto';

// Types
export interface CollaborationConfig {
  enabled: boolean;
  serverUrl: string;
  sessionTimeout: number;
}

export interface CollaborationSession {
  id: string;
  createdBy: string;
  createdAt: Date;
  participants: string[];
  messages: CollaborationMessage[];
  activeTask?: string;
}

export interface CollaborationMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: Date;
  type: 'text' | 'code' | 'result' | 'system';
}

export interface CollaborationParticipant {
  id: string;
  name: string;
  isActive: boolean;
  lastActive: Date;
}

// Main collaboration service
export class CollaborationService {
  private sessions: Map<string, CollaborationSession> = new Map();
  private currentSessionId?: string;
  private websocket?: WebSocket;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  
  constructor(
    private readonly config: CollaborationConfig,
    private readonly context: vscode.ExtensionContext
  ) {
    if (this.config.enabled) {
      this.initialize();
    }
  }
  
  private async initialize(): Promise<void> {
    try {
      // Connect to collaboration server
      await this.connectToServer();
      
      // Register commands
      this.registerCommands();
      
      console.log('Collaboration service initialized');
    } catch (error) {
      console.error('Failed to initialize collaboration service:', error);
      vscode.window.showErrorMessage(`Failed to initialize collaboration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async connectToServer(): Promise<void> {
    if (!this.config.enabled || !this.config.serverUrl) {
      return;
    }
    
    try {
      // Close existing connection if any
      if (this.websocket) {
        this.websocket.close();
      }
      
      // Connect to server
      this.websocket = new WebSocket(this.config.serverUrl);
      
      // Set up event handlers
      this.websocket.onopen = this.handleConnectionOpen.bind(this);
      this.websocket.onmessage = this.handleMessage.bind(this);
      this.websocket.onclose = this.handleConnectionClose.bind(this);
      this.websocket.onerror = this.handleConnectionError.bind(this);
      
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('Failed to connect to collaboration server:', error);
      this.attemptReconnect();
    }
  }
  
  private handleConnectionOpen(_event: Event): void {
    console.log('Connected to collaboration server');
    
    // Send authentication message
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const authMessage = {
        type: 'auth',
        token: this.getAuthToken()
      };
      
      this.websocket.send(JSON.stringify(authMessage));
    }
  }
  
  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'session_created':
          this.handleSessionCreated(message.session);
          break;
        case 'session_joined':
          this.handleSessionJoined(message.session, message.participant);
          break;
        case 'session_left':
          this.handleSessionLeft(message.sessionId, message.participantId);
          break;
        case 'message_received':
          this.handleMessageReceived(message.sessionId, message.message);
          break;
        case 'task_started':
          this.handleTaskStarted(message.sessionId, message.taskId, message.taskDetails);
          break;
        case 'task_completed':
          this.handleTaskCompleted(message.sessionId, message.taskId, message.result);
          break;
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }
  
  private handleConnectionClose(event: CloseEvent): void {
    console.log(`Connection to collaboration server closed: ${event.code} - ${event.reason}`);
    
    // Attempt to reconnect
    this.attemptReconnect();
  }
  
  private handleConnectionError(event: Event): void {
    console.error('Collaboration server connection error:', event);
    
    // Attempt to reconnect
    this.attemptReconnect();
  }
  
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached, giving up');
      vscode.window.showErrorMessage('Failed to connect to collaboration server after multiple attempts');
      return;
    }
    
    this.reconnectAttempts++;
    
    // Exponential backoff
    const delay = Math.pow(2, this.reconnectAttempts) * 1000;
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connectToServer();
    }, delay);
  }
  
  private getAuthToken(): string {
    // In a real implementation, this would use a secure authentication mechanism
    // For this demo, we'll use a simple token
    return 'demo-token';
  }
  
  private registerCommands(): void {
    // Register commands for collaboration features
    this.context.subscriptions.push(
      vscode.commands.registerCommand('asura-ai.startCollaboration', this.startCollaboration.bind(this)),
      vscode.commands.registerCommand('asura-ai.joinCollaboration', this.joinCollaboration.bind(this)),
      vscode.commands.registerCommand('asura-ai.leaveCollaboration', this.leaveCollaboration.bind(this)),
      vscode.commands.registerCommand('asura-ai.shareSession', this.shareSession.bind(this))
    );
  }
  
  // Command handlers
  private async startCollaboration(): Promise<void> {
    try {
      // Create a new session
      const sessionId = crypto.randomUUID();
      
      // Get user name
      const userName = await vscode.window.showInputBox({
        prompt: 'Enter your name for the collaboration session',
        placeHolder: 'Your Name'
      });
      
      if (!userName) {
        return;
      }
      
      // Create session locally
      const session: CollaborationSession = {
        id: sessionId,
        createdBy: userName,
        createdAt: new Date(),
        participants: [userName],
        messages: []
      };
      
      this.sessions.set(sessionId, session);
      this.currentSessionId = sessionId;
      
      // Send create session message to server
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        const createSessionMessage = {
          type: 'create_session',
          session
        };
        
        this.websocket.send(JSON.stringify(createSessionMessage));
      }
      
      // Show session info
      vscode.window.showInformationMessage(`Collaboration session started. Session ID: ${sessionId}`);
      
      // Open collaboration panel
      this.openCollaborationPanel(sessionId);
    } catch (error) {
      console.error('Error starting collaboration:', error);
      vscode.window.showErrorMessage(`Failed to start collaboration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async joinCollaboration(): Promise<void> {
    try {
      // Get session ID
      const sessionId = await vscode.window.showInputBox({
        prompt: 'Enter the collaboration session ID',
        placeHolder: 'Session ID'
      });
      
      if (!sessionId) {
        return;
      }
      
      // Get user name
      const userName = await vscode.window.showInputBox({
        prompt: 'Enter your name for the collaboration session',
        placeHolder: 'Your Name'
      });
      
      if (!userName) {
        return;
      }
      
      // Send join session message to server
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        const joinSessionMessage = {
          type: 'join_session',
          sessionId,
          participant: {
            id: crypto.randomUUID(),
            name: userName,
            isActive: true,
            lastActive: new Date()
          }
        };
        
        this.websocket.send(JSON.stringify(joinSessionMessage));
      }
      
      this.currentSessionId = sessionId;
      
      // Open collaboration panel
      this.openCollaborationPanel(sessionId);
    } catch (error) {
      console.error('Error joining collaboration:', error);
      vscode.window.showErrorMessage(`Failed to join collaboration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async leaveCollaboration(): Promise<void> {
    if (!this.currentSessionId) {
      vscode.window.showInformationMessage('You are not in a collaboration session');
      return;
    }
    
    try {
      // Send leave session message to server
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        const leaveSessionMessage = {
          type: 'leave_session',
          sessionId: this.currentSessionId
        };
        
        this.websocket.send(JSON.stringify(leaveSessionMessage));
      }
      
      // Remove session locally
      this.sessions.delete(this.currentSessionId);
      this.currentSessionId = undefined;
      
      vscode.window.showInformationMessage('You have left the collaboration session');
    } catch (error) {
      console.error('Error leaving collaboration:', error);
      vscode.window.showErrorMessage(`Failed to leave collaboration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async shareSession(): Promise<void> {
    if (!this.currentSessionId) {
      vscode.window.showInformationMessage('You are not in a collaboration session');
      return;
    }
    
    // Copy session ID to clipboard
    await vscode.env.clipboard.writeText(this.currentSessionId);
    
    vscode.window.showInformationMessage('Session ID copied to clipboard. Share this with your collaborators.');
  }
  
  // Event handlers
  private handleSessionCreated(session: CollaborationSession): void {
    // Store session locally
    this.sessions.set(session.id, session);
    this.currentSessionId = session.id;
    
    vscode.window.showInformationMessage(`Collaboration session created: ${session.id}`);
  }
  
  private handleSessionJoined(session: CollaborationSession, participant: CollaborationParticipant): void {
    // Update session locally
    this.sessions.set(session.id, session);
    
    // Show notification
    vscode.window.showInformationMessage(`${participant.name} joined the collaboration session`);
    
    // Add system message
    this.addSystemMessage(session.id, `${participant.name} joined the session`);
  }
  
  private handleSessionLeft(sessionId: string, participantId: string): void {
    // Get session
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return;
    }
    
    // Find participant
    const participantIndex = session.participants.findIndex(p => p === participantId);
    
    if (participantIndex === -1) {
      return;
    }
    
    // Get participant name
    const participantName = session.participants[participantIndex];
    
    // Remove participant
    session.participants.splice(participantIndex, 1);
    
    // Update session
    this.sessions.set(sessionId, session);
    
    // Show notification
    vscode.window.showInformationMessage(`${participantName} left the collaboration session`);
    
    // Add system message
    this.addSystemMessage(sessionId, `${participantName} left the session`);
  }
  
  private handleMessageReceived(sessionId: string, message: CollaborationMessage): void {
    // Get session
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return;
    }
    
    // Add message to session
    session.messages.push(message);
    
    // Update session
    this.sessions.set(sessionId, session);
    
    // Update collaboration panel
    this.updateCollaborationPanel(sessionId);
  }
  
  private handleTaskStarted(sessionId: string, taskId: string, taskDetails: any): void {
    // Get session
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return;
    }
    
    // Set active task
    session.activeTask = taskId;
    
    // Update session
    this.sessions.set(sessionId, session);
    
    // Add system message
    this.addSystemMessage(sessionId, `Task started: ${taskDetails.description}`);
  }
  
  private handleTaskCompleted(sessionId: string, _taskId: string, result: any): void {
    // Get session
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return;
    }
    
    // Clear active task
    session.activeTask = undefined;
    
    // Update session
    this.sessions.set(sessionId, session);
    
    // Add system message
    this.addSystemMessage(sessionId, `Task completed: ${result.description}`);
    
    // Add result message
    this.addResultMessage(sessionId, result.content);
  }
  
  // Helper methods
  private addSystemMessage(sessionId: string, content: string): void {
    // Get session
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return;
    }
    
    // Create message
    const message: CollaborationMessage = {
      id: crypto.randomUUID(),
      sender: 'system',
      content,
      timestamp: new Date(),
      type: 'system'
    };
    
    // Add message to session
    session.messages.push(message);
    
    // Update session
    this.sessions.set(sessionId, session);
    
    // Update collaboration panel
    this.updateCollaborationPanel(sessionId);
  }
  
  private addResultMessage(sessionId: string, content: string): void {
    // Get session
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return;
    }
    
    // Create message
    const message: CollaborationMessage = {
      id: crypto.randomUUID(),
      sender: 'asura',
      content,
      timestamp: new Date(),
      type: 'result'
    };
    
    // Add message to session
    session.messages.push(message);
    
    // Update session
    this.sessions.set(sessionId, session);
    
    // Update collaboration panel
    this.updateCollaborationPanel(sessionId);
  }
  
  private openCollaborationPanel(sessionId: string): void {
    // In a real implementation, this would open a webview panel for collaboration
    console.log(`Opening collaboration panel for session ${sessionId}`);
  }
  
  private updateCollaborationPanel(sessionId: string): void {
    // In a real implementation, this would update the collaboration panel
    console.log(`Updating collaboration panel for session ${sessionId}`);
  }
  
  // Public methods
  public isCollaborationActive(): boolean {
    return !!this.currentSessionId;
  }
  
  public getCurrentSessionId(): string | undefined {
    return this.currentSessionId;
  }
  
  public getCurrentSession(): CollaborationSession | undefined {
    if (!this.currentSessionId) {
      return undefined;
    }
    
    return this.sessions.get(this.currentSessionId);
  }
  
  public async sendMessage(content: string, type: 'text' | 'code' = 'text'): Promise<void> {
    if (!this.currentSessionId) {
      vscode.window.showInformationMessage('You are not in a collaboration session');
      return;
    }
    
    // Get session
    const session = this.sessions.get(this.currentSessionId);
    
    if (!session) {
      vscode.window.showErrorMessage('Session not found');
      return;
    }
    
    // Create message
    const message: CollaborationMessage = {
      id: crypto.randomUUID(),
      sender: 'user', // In a real implementation, this would be the user's ID
      content,
      timestamp: new Date(),
      type
    };
    
    // Send message to server
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const sendMessageMessage = {
        type: 'send_message',
        sessionId: this.currentSessionId,
        message
      };
      
      this.websocket.send(JSON.stringify(sendMessageMessage));
    }
    
    // Add message to session locally (optimistic update)
    session.messages.push(message);
    
    // Update session
    this.sessions.set(this.currentSessionId, session);
    
    // Update collaboration panel
    this.updateCollaborationPanel(this.currentSessionId);
  }
  
  public async shareTask(taskId: string, taskDetails: any): Promise<void> {
    if (!this.currentSessionId) {
      vscode.window.showInformationMessage('You are not in a collaboration session');
      return;
    }
    
    // Send task to server
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const shareTaskMessage = {
        type: 'share_task',
        sessionId: this.currentSessionId,
        taskId,
        taskDetails
      };
      
      this.websocket.send(JSON.stringify(shareTaskMessage));
    }
    
    // Add system message
    this.addSystemMessage(this.currentSessionId, `Task shared: ${taskDetails.description}`);
  }
  
  public async shareResult(taskId: string, result: any): Promise<void> {
    if (!this.currentSessionId) {
      vscode.window.showInformationMessage('You are not in a collaboration session');
      return;
    }
    
    // Send result to server
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const shareResultMessage = {
        type: 'share_result',
        sessionId: this.currentSessionId,
        taskId,
        result
      };
      
      this.websocket.send(JSON.stringify(shareResultMessage));
    }
    
    // Add result message
    this.addResultMessage(this.currentSessionId, result.content);
  }
}
