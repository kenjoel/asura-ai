import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

// Types
export interface ContextConfig {
  vectorDbPath: string;
}

interface CodeChunk {
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  type: string;
}

interface ChunkMetadata {
  filePath: string;
  startLine: number;
  endLine: number;
  type: string;
}

interface ContextChunk {
  filePath: string;
  content: string;
  similarity: number;
  type: string;
}

interface ContextResult {
  chunks: ContextChunk[];
  tokenCount: number;
}

// Simple in-memory vector database for demonstration
// In a real implementation, this would use a proper vector database
class VectorDatabase {
  private embeddings: Map<string, {
    vector: number[];
    metadata: any;
  }> = new Map();
  
  constructor(private readonly dbPath: string) {
    // In a real implementation, this would load from disk
  }
  
  addEmbedding(id: string, vector: number[], metadata: any): void {
    this.embeddings.set(id, { vector, metadata });
  }
  
  async findSimilar(queryVector: number[], limit: number): Promise<Array<{
    id: string;
    similarity: number;
    metadata: any;
  }>> {
    // Simple cosine similarity implementation
    const results = Array.from(this.embeddings.entries()).map(([id, data]) => {
      const similarity = this.cosineSimilarity(queryVector, data.vector);
      return {
        id,
        similarity,
        metadata: data.metadata
      };
    });
    
    // Sort by similarity (descending)
    results.sort((a, b) => b.similarity - a.similarity);
    
    // Return top results
    return results.slice(0, limit);
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (normA * normB);
  }
}

export class SemanticContextManager {
  private embeddings: Map<string, number[]> = new Map();
  private fileContents: Map<string, string> = new Map();
  private db: VectorDatabase;
  private initialized: boolean = false;
  
  constructor(private readonly config: ContextConfig) {
    this.db = new VectorDatabase(config.vectorDbPath);
  }
  
  async initialize(workspacePath: string): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      // Scan workspace for code files
      const files = await this.scanWorkspace(workspacePath);
      
      // Process files in batches to avoid memory issues
      const batches = this.createBatches(files, 20);
      
      for (const batch of batches) {
        await Promise.all(batch.map(file => this.processFile(file)));
      }
      
      this.initialized = true;
      console.log(`Semantic context initialized with ${files.length} files`);
    } catch (error) {
      console.error('Error initializing semantic context:', error);
      throw new Error(`Failed to initialize semantic context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async scanWorkspace(workspacePath: string): Promise<string[]> {
    const files: string[] = [];
    
    // Get all files in the workspace
    const getFiles = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip node_modules, .git, and other common directories to ignore
          if (!['node_modules', '.git', 'dist', 'build', 'out'].includes(entry.name)) {
            await getFiles(fullPath);
          }
        } else if (this.isCodeFile(entry.name)) {
          files.push(fullPath);
        }
      }
    };
    
    await getFiles(workspacePath);
    return files;
  }
  
  private isCodeFile(fileName: string): boolean {
    // Check if the file is a code file based on extension
    const ext = path.extname(fileName).toLowerCase();
    return ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php', '.swift', '.kt'].includes(ext);
  }
  
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    
    return batches;
  }
  
  private async processFile(filePath: string): Promise<void> {
    try {
      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');
      this.fileContents.set(filePath, content);
      
      // Parse file to extract semantic chunks
      const chunks = this.extractSemanticChunks(filePath, content);
      
      // Generate embeddings for each chunk
      for (const chunk of chunks) {
        const embedding = await this.generateEmbedding(chunk.content);
        this.db.addEmbedding(chunk.id, embedding, {
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          type: chunk.type
        });
      }
    } catch (error) {
      console.warn(`Error processing file ${filePath}:`, error);
    }
  }
  
  private extractSemanticChunks(filePath: string, content: string): CodeChunk[] {
    // In a real implementation, this would use AST parsing to extract meaningful code chunks
    // For this demo, we'll use a simple line-based approach
    
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    
    // Simple heuristic: split by empty lines and create chunks
    let currentChunk: string[] = [];
    let startLine = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line === '' && currentChunk.length > 0) {
        // End of chunk
        chunks.push({
          id: `${filePath}:${startLine}-${i}`,
          filePath,
          content: currentChunk.join('\n'),
          startLine,
          endLine: i,
          type: this.determineChunkType(currentChunk.join('\n'))
        });
        
        currentChunk = [];
        startLine = i + 1;
      } else if (line !== '') {
        currentChunk.push(lines[i]);
      }
    }
    
    // Add the last chunk if there is one
    if (currentChunk.length > 0) {
      chunks.push({
        id: `${filePath}:${startLine}-${lines.length}`,
        filePath,
        content: currentChunk.join('\n'),
        startLine,
        endLine: lines.length,
        type: this.determineChunkType(currentChunk.join('\n'))
      });
    }
    
    return chunks;
  }
  
  private determineChunkType(content: string): string {
    // Simple heuristic to determine chunk type
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('class ') && (lowerContent.includes('extends ') || lowerContent.includes('implements '))) {
      return 'class-definition';
    } else if (lowerContent.includes('function ') || lowerContent.includes('const ') && lowerContent.includes('=>')) {
      return 'function-definition';
    } else if (lowerContent.includes('interface ') || lowerContent.includes('type ') && lowerContent.includes('=')) {
      return 'type-definition';
    } else if (lowerContent.includes('import ') || lowerContent.includes('require(')) {
      return 'import-statement';
    } else if (lowerContent.includes('export ')) {
      return 'export-statement';
    } else {
      return 'code-block';
    }
  }
  
  async getRelevantContext(query: string, maxTokens: number): Promise<ContextResult> {
    if (!this.initialized) {
      return { chunks: [], tokenCount: 0 };
    }
    
    try {
      // Generate embedding for query
      const queryEmbedding = await this.generateEmbedding(query);
      
      // Find similar chunks in vector database
      const similarChunks = await this.db.findSimilar(queryEmbedding, 10);
      
      // Retrieve actual content for chunks
      const contextChunks = await Promise.all(
        similarChunks.map(async chunk => {
          const metadata = chunk.metadata as ChunkMetadata;
          const content = this.fileContents.get(metadata.filePath) || '';
          
          // Extract the specific chunk from the file content
          const lines = content.split('\n');
          const chunkContent = lines
            .slice(metadata.startLine, metadata.endLine + 1)
            .join('\n');
          
          return {
            filePath: metadata.filePath,
            content: chunkContent,
            similarity: chunk.similarity,
            type: metadata.type
          };
        })
      );
      
      // Prioritize and trim context to fit within token budget
      return this.optimizeContext(contextChunks, maxTokens);
    } catch (error) {
      console.error('Error getting relevant context:', error);
      return { chunks: [], tokenCount: 0 };
    }
  }
  
  private async generateEmbedding(text: string): Promise<number[]> {
    // In a real implementation, this would call an embedding model API
    // For this demo, we'll use a simple hash-based approach
    
    // Generate a deterministic but unique vector based on the text
    const hash = this.simpleHash(text);
    const vector: number[] = [];
    
    // Generate a 128-dimensional vector
    for (let i = 0; i < 128; i++) {
      // Use the hash to seed a simple PRNG
      const value = Math.sin(hash * (i + 1)) * 0.5 + 0.5;
      vector.push(value);
    }
    
    // Normalize the vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / magnitude);
  }
  
  private simpleHash(text: string): number {
    let hash = 0;
    
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return Math.abs(hash);
  }
  
  private optimizeContext(chunks: ContextChunk[], maxTokens: number): ContextResult {
    // Simple token counting (approximate)
    const estimateTokens = (text: string): number => {
      // Rough estimate: 1 token ≈ 4 characters
      return Math.ceil(text.length / 4);
    };
    
    // Sort chunks by similarity (descending)
    chunks.sort((a, b) => b.similarity - a.similarity);
    
    // Keep adding chunks until we hit the token budget
    const result: ContextChunk[] = [];
    let tokenCount = 0;
    
    for (const chunk of chunks) {
      const chunkTokens = estimateTokens(chunk.content);
      
      if (tokenCount + chunkTokens <= maxTokens) {
        result.push(chunk);
        tokenCount += chunkTokens;
      } else {
        // If we can't fit the whole chunk, try to fit a portion
        if (tokenCount < maxTokens) {
          const remainingTokens = maxTokens - tokenCount;
          const truncatedContent = chunk.content.substring(0, remainingTokens * 4);
          
          result.push({
            ...chunk,
            content: truncatedContent
          });
          
          tokenCount += estimateTokens(truncatedContent);
        }
        
        break;
      }
    }
    
    return {
      chunks: result,
      tokenCount
    };
  }
}
