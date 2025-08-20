import { promises as fs } from 'fs';
import { resolve, dirname } from 'path';

/**
 * Filesystem MCP Service
 * Provides basic file operations: read, create, and delete files
 */
export class FilesystemMCPService {
  private basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = resolve(basePath);
  }

  /**
   * Get the content of a file
   * @param filePath - Path to the file relative to base path
   * @returns File content as string
   * @throws Error if file doesn't exist or cannot be read
   */
  async getFileContent(filePath: string): Promise<string> {
    try {
      const fullPath = this.resolvePath(filePath);
      await this.validatePath(fullPath);

      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a new file with specified content
   * @param filePath - Path where the file should be created
   * @param content - Content to write to the file
   * @param createDirectories - Whether to create parent directories if they don't exist
   * @returns Success message
   * @throws Error if file creation fails
   */
  async createFile(filePath: string, content: string, createDirectories: boolean = true): Promise<string> {
    try {
      const fullPath = this.resolvePath(filePath);

      // Check if file already exists
      try {
        await fs.access(fullPath);
        throw new Error(`File already exists: ${filePath}`);
      } catch (error) {
        // File doesn't exist, which is what we want
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Create parent directories if needed
      if (createDirectories) {
        const dir = dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(fullPath, content, 'utf-8');
      return `File created successfully: ${filePath}`;
    } catch (error) {
      throw new Error(`Failed to create file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a file
   * @param filePath - Path to the file to delete
   * @returns Success message
   * @throws Error if file deletion fails
   */
  async deleteFile(filePath: string): Promise<string> {
    try {
      const fullPath = this.resolvePath(filePath);
      await this.validatePath(fullPath);

      const stats = await fs.stat(fullPath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }

      await fs.unlink(fullPath);
      return `File deleted successfully: ${filePath}`;
    } catch (error) {
      throw new Error(`Failed to delete file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List files in a directory
   * @param dirPath - Directory path relative to base path
   * @returns Array of file names
   * @throws Error if directory cannot be read
   */
  async listFiles(dirPath: string = '.'): Promise<string[]> {
    try {
      const fullPath = this.resolvePath(dirPath);
      await this.validatePath(fullPath);

      const stats = await fs.stat(fullPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
      }

      const files = await fs.readdir(fullPath);
      return files;
    } catch (error) {
      throw new Error(`Failed to list files in ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if a file or directory exists
   * @param filePath - Path to check
   * @returns Boolean indicating existence
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(filePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file information (stats)
   * @param filePath - Path to the file
   * @returns File stats object
   * @throws Error if file doesn't exist
   */
  async getFileInfo(filePath: string): Promise<{
    size: number;
    isFile: boolean;
    isDirectory: boolean;
    modified: Date;
    created: Date;
  }> {
    try {
      const fullPath = this.resolvePath(filePath);
      await this.validatePath(fullPath);
      
      const stats = await fs.stat(fullPath);
      return {
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        modified: stats.mtime,
        created: stats.birthtime,
      };
    } catch (error) {
      throw new Error(`Failed to get file info for ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Resolve path relative to base path and normalize it
   * @private
   */
  private resolvePath(filePath: string): string {
    // Remove any leading slashes to treat as relative path
    const relativePath = filePath.replace(/^\/+/, '');
    return resolve(this.basePath, relativePath);
  }

  /**
   * Validate that the path is within the allowed base directory
   * @private
   */
  private async validatePath(fullPath: string): Promise<void> {
    const normalizedPath = resolve(fullPath);
    const normalizedBase = resolve(this.basePath);

    if (!normalizedPath.startsWith(normalizedBase)) {
      throw new Error('Access denied: Path is outside of allowed directory');
    }
  }
}

// Export a default instance
export const filesystemService = new FilesystemMCPService();

// MCP Tool definitions for integration
export const mcpTools = [
  {
    name: 'filesystem_read',
    description: 'Read the content of a file',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to read'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'filesystem_create',
    description: 'Create a new file with specified content',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path where the file should be created'
        },
        content: {
          type: 'string',
          description: 'Content to write to the file'
        },
        createDirectories: {
          type: 'boolean',
          description: 'Whether to create parent directories if they don\'t exist',
          default: true
        }
      },
      required: ['filePath', 'content']
    }
  },
  {
    name: 'filesystem_delete',
    description: 'Delete a file',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to delete'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'filesystem_list',
    description: 'List files in a directory',
    inputSchema: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: 'Directory path to list files from',
          default: '.'
        }
      }
    }
  }
];