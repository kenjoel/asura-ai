import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Types
export interface SecurityConfig {
  enabled: boolean;
  encryptionEnabled: boolean;
  auditLoggingEnabled: boolean;
  sandboxingEnabled: boolean;
  secureStoragePath: string;
  auditLogPath: string;
}

export interface EncryptionKey {
  id: string;
  key: Buffer;
  algorithm: string;
  created: Date;
}

export enum AuditLogLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  SECURITY = 'SECURITY'
}

export interface AuditLogEntry {
  timestamp: Date;
  level: AuditLogLevel;
  operation: string;
  user?: string;
  resource?: string;
  details?: any;
  success: boolean;
}

// Main security service
export class SecurityService {
  private encryptionKeys: Map<string, EncryptionKey> = new Map();
  private currentKeyId?: string;
  private initialized: boolean = false;
  
  constructor(
    private readonly config: SecurityConfig,
    private readonly context: vscode.ExtensionContext
  ) {
    if (this.config.enabled) {
      this.initialize();
    }
  }
  
  private async initialize(): Promise<void> {
    try {
      // Create secure storage directory if it doesn't exist
      await fs.mkdir(this.config.secureStoragePath, { recursive: true });
      
      // Create audit log directory if it doesn't exist
      if (this.config.auditLoggingEnabled) {
        await fs.mkdir(path.dirname(this.config.auditLogPath), { recursive: true });
      }
      
      // Load encryption keys
      if (this.config.encryptionEnabled) {
        await this.loadEncryptionKeys();
      }
      
      this.initialized = true;
      console.log('Security service initialized');
      
      // Log initialization
      await this.logAudit(AuditLogLevel.INFO, 'security.initialize', undefined, undefined, { enabled: this.config.enabled }, true);
    } catch (error) {
      console.error('Failed to initialize security service:', error);
      vscode.window.showErrorMessage(`Failed to initialize security service: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async loadEncryptionKeys(): Promise<void> {
    try {
      // Check if keys file exists
      const keysPath = path.join(this.config.secureStoragePath, 'keys.json');
      
      try {
        const keysData = await fs.readFile(keysPath, 'utf-8');
        const keys = JSON.parse(keysData);
        
        // Load keys
        for (const key of keys) {
          this.encryptionKeys.set(key.id, {
            ...key,
            key: Buffer.from(key.key, 'base64'),
            created: new Date(key.created)
          });
        }
        
        // Set current key to the most recent one
        if (keys.length > 0) {
          const sortedKeys = keys.sort((a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime());
          this.currentKeyId = sortedKeys[0].id;
        } else {
          // No keys found, create a new one
          await this.generateEncryptionKey();
        }
      } catch (error) {
        // Keys file doesn't exist, create a new key
        await this.generateEncryptionKey();
      }
    } catch (error) {
      console.error('Error loading encryption keys:', error);
      throw new Error(`Failed to load encryption keys: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async saveEncryptionKeys(): Promise<void> {
    if (!this.config.encryptionEnabled) {
      return;
    }
    
    try {
      // Prepare keys for saving
      const keys = Array.from(this.encryptionKeys.values()).map(key => ({
        id: key.id,
        key: key.key.toString('base64'),
        algorithm: key.algorithm,
        created: key.created
      }));
      
      // Save keys
      const keysPath = path.join(this.config.secureStoragePath, 'keys.json');
      await fs.writeFile(keysPath, JSON.stringify(keys, null, 2), 'utf-8');
      
      // Set file permissions to be readable only by the owner
      await fs.chmod(keysPath, 0o600);
    } catch (error) {
      console.error('Error saving encryption keys:', error);
      throw new Error(`Failed to save encryption keys: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async generateEncryptionKey(): Promise<string> {
    if (!this.config.encryptionEnabled) {
      throw new Error('Encryption is not enabled');
    }
    
    try {
      // Generate a new key
      const keyId = crypto.randomUUID();
      const key = crypto.randomBytes(32); // 256-bit key
      
      // Store the key
      this.encryptionKeys.set(keyId, {
        id: keyId,
        key,
        algorithm: 'aes-256-gcm',
        created: new Date()
      });
      
      // Set as current key
      this.currentKeyId = keyId;
      
      // Save keys
      await this.saveEncryptionKeys();
      
      // Log key generation
      await this.logAudit(AuditLogLevel.SECURITY, 'security.generateKey', undefined, undefined, { keyId }, true);
      
      return keyId;
    } catch (error) {
      console.error('Error generating encryption key:', error);
      throw new Error(`Failed to generate encryption key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  public async logAudit(level: AuditLogLevel, operation: string, user?: string, resource?: string, details?: any, success: boolean = true): Promise<void> {
    if (!this.config.auditLoggingEnabled) {
      return;
    }
    
    try {
      // Create log entry
      const entry: AuditLogEntry = {
        timestamp: new Date(),
        level,
        operation,
        user: user || os.userInfo().username,
        resource,
        details,
        success
      };
      
      // Format log entry
      const logLine = `[${entry.timestamp.toISOString()}] [${entry.level}] [${entry.operation}] [${entry.user}] [${entry.success ? 'SUCCESS' : 'FAILURE'}] ${entry.resource ? `[${entry.resource}] ` : ''}${entry.details ? JSON.stringify(entry.details) : ''}\n`;
      
      // Append to log file
      await fs.appendFile(this.config.auditLogPath, logLine, 'utf-8');
    } catch (error) {
      console.error('Error logging audit entry:', error);
      // Don't throw here to avoid cascading failures
    }
  }
  
  // Public methods
  
  /**
   * Encrypts sensitive data
   * @param data The data to encrypt
   * @returns The encrypted data as a string
   */
  public async encrypt(data: string): Promise<string> {
    if (!this.config.encryptionEnabled || !this.initialized) {
      throw new Error('Encryption is not enabled or security service is not initialized');
    }
    
    try {
      // Get current key
      if (!this.currentKeyId) {
        throw new Error('No encryption key available');
      }
      
      const key = this.encryptionKeys.get(this.currentKeyId);
      
      if (!key) {
        throw new Error('Current encryption key not found');
      }
      
      // Generate initialization vector
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipheriv(key.algorithm, key.key, iv) as crypto.CipherGCM;
      
      // Encrypt data
      let encrypted = cipher.update(data, 'utf-8', 'base64');
      encrypted += cipher.final('base64');
      
      // Get auth tag
      const authTag = cipher.getAuthTag();
      
      // Combine key ID, IV, auth tag, and encrypted data
      const result = JSON.stringify({
        keyId: key.id,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        data: encrypted
      });
      
      // Log encryption operation
      await this.logAudit(AuditLogLevel.INFO, 'security.encrypt', undefined, undefined, { keyId: key.id }, true);
      
      return Buffer.from(result).toString('base64');
    } catch (error) {
      console.error('Error encrypting data:', error);
      await this.logAudit(AuditLogLevel.ERROR, 'security.encrypt', undefined, undefined, { error: error instanceof Error ? error.message : String(error) }, false);
      throw new Error(`Failed to encrypt data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Decrypts encrypted data
   * @param encryptedData The encrypted data as a string
   * @returns The decrypted data
   */
  public async decrypt(encryptedData: string): Promise<string> {
    if (!this.config.encryptionEnabled || !this.initialized) {
      throw new Error('Encryption is not enabled or security service is not initialized');
    }
    
    try {
      // Parse encrypted data
      const parsed = JSON.parse(Buffer.from(encryptedData, 'base64').toString('utf-8'));
      
      // Get key
      const key = this.encryptionKeys.get(parsed.keyId);
      
      if (!key) {
        throw new Error(`Encryption key not found: ${parsed.keyId}`);
      }
      
      // Create decipher
      const iv = Buffer.from(parsed.iv, 'base64');
      const authTag = Buffer.from(parsed.authTag, 'base64');
      const decipher = crypto.createDecipheriv(key.algorithm, key.key, iv) as crypto.DecipherGCM;
      
      // Set auth tag
      decipher.setAuthTag(authTag);
      
      // Decrypt data
      let decrypted = decipher.update(parsed.data, 'base64', 'utf-8');
      decrypted += decipher.final('utf-8');
      
      // Log decryption operation
      await this.logAudit(AuditLogLevel.INFO, 'security.decrypt', undefined, undefined, { keyId: key.id }, true);
      
      return decrypted;
    } catch (error) {
      console.error('Error decrypting data:', error);
      await this.logAudit(AuditLogLevel.ERROR, 'security.decrypt', undefined, undefined, { error: error instanceof Error ? error.message : String(error) }, false);
      throw new Error(`Failed to decrypt data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Securely stores a value in the secure storage
   * @param key The key to store the value under
   * @param value The value to store
   */
  public async secureStore(key: string, value: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('Security service is not initialized');
    }
    
    try {
      // Sanitize key
      const sanitizedKey = this.sanitizeKey(key);
      
      // Encrypt value if encryption is enabled
      const valueToStore = this.config.encryptionEnabled ? await this.encrypt(value) : value;
      
      // Store value
      const filePath = path.join(this.config.secureStoragePath, sanitizedKey);
      await fs.writeFile(filePath, valueToStore, 'utf-8');
      
      // Set file permissions to be readable only by the owner
      await fs.chmod(filePath, 0o600);
      
      // Log storage operation
      await this.logAudit(AuditLogLevel.INFO, 'security.secureStore', undefined, sanitizedKey, undefined, true);
    } catch (error) {
      console.error('Error storing secure value:', error);
      await this.logAudit(AuditLogLevel.ERROR, 'security.secureStore', undefined, key, { error: error instanceof Error ? error.message : String(error) }, false);
      throw new Error(`Failed to store secure value: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Retrieves a value from the secure storage
   * @param key The key to retrieve the value for
   * @returns The stored value, or undefined if not found
   */
  public async secureRetrieve(key: string): Promise<string | undefined> {
    if (!this.initialized) {
      throw new Error('Security service is not initialized');
    }
    
    try {
      // Sanitize key
      const sanitizedKey = this.sanitizeKey(key);
      
      // Get value
      const filePath = path.join(this.config.secureStoragePath, sanitizedKey);
      
      try {
        const value = await fs.readFile(filePath, 'utf-8');
        
        // Decrypt value if encryption is enabled
        const decryptedValue = this.config.encryptionEnabled ? await this.decrypt(value) : value;
        
        // Log retrieval operation
        await this.logAudit(AuditLogLevel.INFO, 'security.secureRetrieve', undefined, sanitizedKey, undefined, true);
        
        return decryptedValue;
      } catch (error) {
        // Value not found
        return undefined;
      }
    } catch (error) {
      console.error('Error retrieving secure value:', error);
      await this.logAudit(AuditLogLevel.ERROR, 'security.secureRetrieve', undefined, key, { error: error instanceof Error ? error.message : String(error) }, false);
      throw new Error(`Failed to retrieve secure value: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Deletes a value from the secure storage
   * @param key The key to delete
   */
  public async secureDelete(key: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('Security service is not initialized');
    }
    
    try {
      // Sanitize key
      const sanitizedKey = this.sanitizeKey(key);
      
      // Delete value
      const filePath = path.join(this.config.secureStoragePath, sanitizedKey);
      
      try {
        await fs.unlink(filePath);
        
        // Log deletion operation
        await this.logAudit(AuditLogLevel.INFO, 'security.secureDelete', undefined, sanitizedKey, undefined, true);
      } catch (error) {
        // Value not found, that's okay
      }
    } catch (error) {
      console.error('Error deleting secure value:', error);
      await this.logAudit(AuditLogLevel.ERROR, 'security.secureDelete', undefined, key, { error: error instanceof Error ? error.message : String(error) }, false);
      throw new Error(`Failed to delete secure value: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Sanitizes user input to prevent injection attacks
   * @param input The user input to sanitize
   * @returns The sanitized input
   */
  public sanitizeInput(input: string): string {
    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '') // Remove HTML tags
      .replace(/[;`|&$]/g, '') // Remove shell command characters
      .trim();
  }
  
  /**
   * Validates that a string contains only safe characters
   * @param input The input to validate
   * @param pattern The regex pattern to validate against
   * @returns True if the input is valid, false otherwise
   */
  public validateInput(input: string, pattern: RegExp): boolean {
    return pattern.test(input);
  }
  
  /**
   * Creates a sandbox for executing untrusted code
   * @param code The code to execute
   * @param context The context to provide to the code
   * @returns The result of the code execution
   */
  public async executeSandboxed(code: string, context: any = {}): Promise<any> {
    if (!this.config.sandboxingEnabled || !this.initialized) {
      throw new Error('Sandboxing is not enabled or security service is not initialized');
    }
    
    try {
      // Log sandboxed execution
      await this.logAudit(AuditLogLevel.SECURITY, 'security.executeSandboxed', undefined, undefined, { codeLength: code.length }, true);
      
      // In a real implementation, this would use a proper sandboxing solution
      // For this demo, we'll use a simple approach with Function constructor
      // NOTE: This is NOT secure for production use!
      
      // Create a function from the code
      const sandboxedFunction = new Function('context', `
        "use strict";
        // Prevent access to global objects
        const window = undefined;
        const document = undefined;
        const process = undefined;
        const require = undefined;
        const global = undefined;
        const __dirname = undefined;
        const __filename = undefined;
        
        // Provide safe console
        const console = {
          log: function(...args) {
            context.__logs = context.__logs || [];
            context.__logs.push(args.map(arg => String(arg)).join(' '));
          },
          error: function(...args) {
            context.__errors = context.__errors || [];
            context.__errors.push(args.map(arg => String(arg)).join(' '));
          }
        };
        
        // Execute the code
        ${code}
        
        // Return the context
        return context;
      `);
      
      // Execute the function
      const result = sandboxedFunction(context);
      
      return result;
    } catch (error) {
      console.error('Error executing sandboxed code:', error);
      await this.logAudit(AuditLogLevel.ERROR, 'security.executeSandboxed', undefined, undefined, { error: error instanceof Error ? error.message : String(error) }, false);
      throw new Error(`Failed to execute sandboxed code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Checks if a file operation is allowed based on permissions
   * @param filePath The path of the file to check
   * @param operation The operation to perform (read, write, execute)
   * @returns True if the operation is allowed, false otherwise
   */
  public async checkFilePermission(filePath: string, operation: 'read' | 'write' | 'execute'): Promise<boolean> {
    if (!this.initialized) {
      throw new Error('Security service is not initialized');
    }
    
    try {
      // Get workspace folders
      const workspaceFolders = vscode.workspace.workspaceFolders;
      
      if (!workspaceFolders || workspaceFolders.length === 0) {
        // No workspace folders, deny access
        await this.logAudit(AuditLogLevel.WARNING, 'security.checkFilePermission', undefined, filePath, { operation, allowed: false, reason: 'No workspace folders' }, false);
        return false;
      }
      
      // Check if file is within workspace
      const isInWorkspace = workspaceFolders.some(folder => {
        const folderPath = folder.uri.fsPath;
        return filePath.startsWith(folderPath);
      });
      
      if (!isInWorkspace) {
        // File is outside workspace, deny access
        await this.logAudit(AuditLogLevel.WARNING, 'security.checkFilePermission', undefined, filePath, { operation, allowed: false, reason: 'File outside workspace' }, false);
        return false;
      }
      
      // Check if file exists
      try {
        const stats = await fs.stat(filePath);
        
        // Check permissions based on operation
        switch (operation) {
          case 'read':
            // Allow read for all files in workspace
            await this.logAudit(AuditLogLevel.INFO, 'security.checkFilePermission', undefined, filePath, { operation, allowed: true }, true);
            return true;
          
          case 'write':
            // Check if file is writable
            try {
              await fs.access(filePath, fs.constants.W_OK);
              await this.logAudit(AuditLogLevel.INFO, 'security.checkFilePermission', undefined, filePath, { operation, allowed: true }, true);
              return true;
            } catch (error) {
              await this.logAudit(AuditLogLevel.WARNING, 'security.checkFilePermission', undefined, filePath, { operation, allowed: false, reason: 'File not writable' }, false);
              return false;
            }
          
          case 'execute':
            // Check if file is executable
            if (stats.isFile()) {
              try {
                await fs.access(filePath, fs.constants.X_OK);
                await this.logAudit(AuditLogLevel.INFO, 'security.checkFilePermission', undefined, filePath, { operation, allowed: true }, true);
                return true;
              } catch (error) {
                await this.logAudit(AuditLogLevel.WARNING, 'security.checkFilePermission', undefined, filePath, { operation, allowed: false, reason: 'File not executable' }, false);
                return false;
              }
            } else {
              await this.logAudit(AuditLogLevel.WARNING, 'security.checkFilePermission', undefined, filePath, { operation, allowed: false, reason: 'Not a file' }, false);
              return false;
            }
        }
      } catch (error) {
        // File doesn't exist
        if (operation === 'write') {
          // Allow creating new files
          await this.logAudit(AuditLogLevel.INFO, 'security.checkFilePermission', undefined, filePath, { operation, allowed: true, reason: 'Creating new file' }, true);
          return true;
        } else {
          await this.logAudit(AuditLogLevel.WARNING, 'security.checkFilePermission', undefined, filePath, { operation, allowed: false, reason: 'File does not exist' }, false);
          return false;
        }
      }
    } catch (error) {
      console.error('Error checking file permission:', error);
      await this.logAudit(AuditLogLevel.ERROR, 'security.checkFilePermission', undefined, filePath, { operation, error: error instanceof Error ? error.message : String(error) }, false);
      throw new Error(`Failed to check file permission: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Default deny
    return false;
  }
  
  /**
   * Gets the audit log entries
   * @param limit The maximum number of entries to return
   * @param level The log level to filter by
   * @returns The audit log entries
   */
  public async getAuditLog(limit: number = 100, level?: AuditLogLevel): Promise<AuditLogEntry[]> {
    if (!this.config.auditLoggingEnabled || !this.initialized) {
      throw new Error('Audit logging is not enabled or security service is not initialized');
    }
    
    try {
      // Read log file
      const logContent = await fs.readFile(this.config.auditLogPath, 'utf-8');
      
      // Parse log entries
      const entries: AuditLogEntry[] = [];
      
      const lines = logContent.split('\n').filter(line => line.trim() !== '');
      
      for (const line of lines) {
        try {
          // Parse log line
          const match = line.match(/\[(.*?)\] \[(.*?)\] \[(.*?)\] \[(.*?)\] \[(.*?)\](?: \[(.*?)\])? (.*)/);
          
          if (match) {
            const entry: AuditLogEntry = {
              timestamp: new Date(match[1]),
              level: match[2] as AuditLogLevel,
              operation: match[3],
              user: match[4],
              success: match[5] === 'SUCCESS',
              resource: match[6],
              details: match[7] ? JSON.parse(match[7]) : undefined
            };
            
            // Filter by level if specified
            if (!level || entry.level === level) {
              entries.push(entry);
            }
          }
        } catch (error) {
          // Skip invalid log entries
          console.error('Error parsing log entry:', error);
        }
      }
      
      // Sort by timestamp (newest first) and limit
      return entries
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    } catch (error) {
      console.error('Error getting audit log:', error);
      throw new Error(`Failed to get audit log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Helper methods
  
  private sanitizeKey(key: string): string {
    // Replace any characters that are not alphanumeric, dash, or underscore
    return key.replace(/[^a-zA-Z0-9\-_]/g, '_');
  }
}
