import { promises as fs } from 'fs';
import * as path from 'path';
const { resolve, dirname, isAbsolute } = path;

interface SearchMatch {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  column: number;
}

interface SearchResult {
  query: string;
  totalMatches: number;
  matches: SearchMatch[];
  searchedFiles: number;
}

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
   * Get the content of a file with specified line range
   * @param filePath - Path to the file (relative to base path or absolute)
   * @param startLine - Starting line number (1-indexed, inclusive)
   * @param endLine - Ending line number (1-indexed, inclusive)
   * @returns Object containing the requested content with line numbers and metadata
   * @throws Error if file doesn't exist or cannot be read
   */
  async getFileContent(
    filePath: string,
    startLine: number,
    endLine: number
  ): Promise<{ content: string; startLine: number; endLine: number; totalLines: number }> {
    try {
      const fullPath = this.resolvePath(filePath);

      // For absolute paths, skip validation to allow access outside base path
      if (!isAbsolute(filePath)) {
        await this.validatePath(fullPath);
      }

      // Check if the path is a directory, if so, list its contents instead
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        const files = await this.listFiles(filePath);
        const fileList = files.join('\n');
        const lines = fileList.split('\n');
        return {
          content: `Directory: ${filePath}\n\n${fileList}`,
          startLine: 1,
          endLine: lines.length,
          totalLines: lines.length
        };
      }

      const content = await fs.readFile(fullPath, 'utf-8');

      // Parse lines
      const lines = content.split('\n');
      const totalLines = lines.length;

      // Validate and adjust line numbers
      if (startLine < 1) {
        throw new Error('Start line must be greater than 0');
      }
      if (endLine < startLine) {
        throw new Error('End line must be greater than or equal to start line');
      }
      if (startLine > totalLines) {
        throw new Error(`Start line ${startLine} exceeds file length ${totalLines}`);
      }

      const start = startLine;
      const end = Math.min(totalLines, endLine);

      // Extract specified lines (convert to 0-indexed) and add line numbers
      const selectedLines = lines.slice(start - 1, end);

      // Format with line numbers (similar to cat -n)
      // Calculate the width needed for line numbers
      const maxLineNumWidth = String(end).length;
      const numberedLines = selectedLines.map((line, index) => {
        const lineNum = start + index;
        const paddedLineNum = String(lineNum).padStart(maxLineNumWidth, ' ');
        return `${paddedLineNum}→${line}`;
      });

      const partialContent = numberedLines.join('\n');

      return {
        content: partialContent,
        startLine: start,
        endLine: end,
        totalLines
      };
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
   * @param dirPath - Directory path relative to base path or absolute path
   * @returns Array of file names
   * @throws Error if directory cannot be read
   */
  async listFiles(dirPath: string = '.'): Promise<string[]> {
    try {
      const fullPath = this.resolvePath(dirPath);

      // For absolute paths, skip validation to allow access outside base path
      if (!isAbsolute(dirPath)) {
        await this.validatePath(fullPath);
      }

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
   * Edit a file by replacing lines within a specified range
   * @param filePath - Path to the file to edit
   * @param startLine - Starting line number (1-indexed, inclusive)
   * @param endLine - Ending line number (1-indexed, inclusive)
   * @param newContent - New content to replace the specified lines
   * @param contextLines - Number of context lines to return before and after the edit (default: 50)
   * @returns Object containing success message, old content, new content, and context
   * @throws Error if file editing fails
   */
  async editFile(
    filePath: string,
    startLine: number,
    endLine: number,
    newContent: string,
    contextLines: number = 50
  ): Promise<{
    message: string;
    oldContent: string;
    newContent: string;
    contextStartLine: number;
    contextEndLine: number;
    totalLines: number;
  }> {
    try {
      const fullPath = this.resolvePath(filePath);

      // For absolute paths, skip validation to allow access outside base path
      if (!isAbsolute(filePath)) {
        await this.validatePath(fullPath);
      }

      // Read the entire file
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      // Validate line numbers
      if (startLine < 1 || endLine < 1) {
        throw new Error('Line numbers must be greater than 0');
      }
      if (startLine > endLine) {
        throw new Error('Start line must be less than or equal to end line');
      }
      if (startLine > totalLines) {
        throw new Error(`Start line ${startLine} exceeds file length ${totalLines}`);
      }

      // Adjust endLine if it exceeds file length
      const adjustedEndLine = Math.min(endLine, totalLines);

      // Calculate context range
      const contextStart = Math.max(1, startLine - contextLines);
      const contextEnd = Math.min(totalLines, endLine + contextLines);

      // Extract old content for context (including the lines to be replaced)
      const oldContextLines = lines.slice(contextStart - 1, contextEnd);
      const oldContent = oldContextLines.join('\n');

      // Replace the specified lines
      const newContentLines = newContent.split('\n');
      const beforeLines = lines.slice(0, startLine - 1);
      const afterLines = lines.slice(adjustedEndLine);
      const modifiedLines = [...beforeLines, ...newContentLines, ...afterLines];

      // Calculate new context range
      const newTotalLines = modifiedLines.length;
      const lineDifference = newContentLines.length - (adjustedEndLine - startLine + 1);
      const newContextEnd = Math.min(newTotalLines, contextEnd + lineDifference);

      // Extract new content for context
      const newContextLines = modifiedLines.slice(contextStart - 1, newContextEnd);
      const newContextContent = newContextLines.join('\n');

      // Write the modified content back to file
      await fs.writeFile(fullPath, modifiedLines.join('\n'), 'utf-8');

      return {
        message: `File edited successfully: ${filePath} (lines ${startLine}-${adjustedEndLine} replaced)`,
        oldContent,
        newContent: newContextContent,
        contextStartLine: contextStart,
        contextEndLine: newContextEnd,
        totalLines: newTotalLines
      };
    } catch (error) {
      throw new Error(`Failed to edit file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search for code keywords in files within a directory
   * @param query - Search keyword or pattern
   * @param dirPath - Directory to search in (default: current directory)
   * @param fileExtensions - Array of file extensions to search (e.g., ['.ts', '.tsx', '.js']). If empty, search all files.
   * @param caseSensitive - Whether the search should be case-sensitive (default: false)
   * @param maxResults - Maximum number of results to return (default: 100)
   * @returns Search results with file paths, line numbers, and matched content
   */
  async searchCode(
    query: string,
    dirPath: string = '.',
    fileExtensions: string[] = [],
    caseSensitive: boolean = false,
    maxResults: number = 100
  ): Promise<SearchResult> {
    const matches: SearchMatch[] = [];
    let searchedFiles = 0;
    const fullDirPath = this.resolvePath(dirPath);

    // Convert query to regex for flexible matching
    const flags = caseSensitive ? 'g' : 'gi';
    const searchRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    // Recursively search files
    const searchInDirectory = async (currentPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          if (matches.length >= maxResults) {
            return;
          }

          const fullPath = path.join(currentPath, entry.name);

          // Skip common directories that should be ignored
          if (entry.isDirectory()) {
            const dirName = entry.name;
            if (dirName === 'node_modules' || dirName === '.git' || dirName === 'dist' || dirName === 'build' || dirName.startsWith('.')) {
              continue;
            }
            await searchInDirectory(fullPath);
          } else if (entry.isFile()) {
            // Filter by file extension if specified
            if (fileExtensions.length > 0) {
              const ext = path.extname(entry.name);
              if (!fileExtensions.includes(ext)) {
                continue;
              }
            }

            searchedFiles++;

            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');

              lines.forEach((line, index) => {
                if (matches.length >= maxResults) {
                  return;
                }

                // Reset regex for each line
                searchRegex.lastIndex = 0;
                const match = searchRegex.exec(line);

                if (match) {
                  matches.push({
                    filePath: path.relative(this.basePath, fullPath),
                    lineNumber: index + 1,
                    lineContent: line.trim(),
                    column: match.index + 1
                  });
                }
              });
            } catch (error) {
              // Skip files that cannot be read (binary files, permission issues, etc.)
            }
          }
        }
      } catch (error) {
        // Skip directories that cannot be accessed
      }
    };

    await searchInDirectory(fullDirPath);

    return {
      query,
      totalMatches: matches.length,
      matches,
      searchedFiles
    };
  }

  /**
   * Resolve path relative to base path and normalize it
   * @private
   */
  private resolvePath(filePath: string): string {
    // Check if the path is already absolute
    const isAbsolute = path.isAbsolute(filePath);

    if (isAbsolute) {
      // Return absolute path as-is (will be validated later)
      return resolve(filePath);
    }

    // For relative paths, resolve against base path
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
    description: 'Read the content of a file within specified line range. The returned content includes line numbers (format: "lineNum→content") for precise editing. You MUST specify startLine and endLine. To read the entire file, use startLine=1 and a large endLine value (e.g., 999999). IMPORTANT: When you need to edit a file, you MUST read it first to see the exact line numbers and current content. NOTE: If the path points to a directory, this tool will automatically list its contents instead of throwing an error.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to read (or directory to list)'
        },
        startLine: {
          type: 'number',
          description: 'Starting line number (1-indexed, inclusive). Must be >= 1.'
        },
        endLine: {
          type: 'number',
          description: 'Ending line number (1-indexed, inclusive). Can exceed file length (will be capped automatically).'
        }
      },
      required: ['filePath', 'startLine', 'endLine']
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
  },
  {
    name: 'filesystem_edit',
    description: 'Edit a file by replacing lines within a specified range. CRITICAL: You MUST use filesystem_read first to see the exact line numbers and current content before editing. This ensures precise line-based editing without errors. Returns context around the edited region for verification.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to edit'
        },
        startLine: {
          type: 'number',
          description: 'Starting line number (1-indexed, inclusive). Get this from filesystem_read output.'
        },
        endLine: {
          type: 'number',
          description: 'Ending line number (1-indexed, inclusive). Get this from filesystem_read output.'
        },
        newContent: {
          type: 'string',
          description: 'New content to replace the specified lines. Do NOT include line numbers in this content.'
        },
        contextLines: {
          type: 'number',
          description: 'Number of context lines to return before and after the edit (default: 50)',
          default: 50
        }
      },
      required: ['filePath', 'startLine', 'endLine', 'newContent']
    }
  },
  {
    name: 'filesystem_search',
    description: 'Search for code keywords across files in a directory. Useful for finding function definitions, variable usages, or any code patterns. Similar to VS Code\'s global search feature.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The keyword or text to search for (e.g., function name, variable name, or any code pattern)'
        },
        dirPath: {
          type: 'string',
          description: 'Directory to search in (relative to base path or absolute). Defaults to current directory.',
          default: '.'
        },
        fileExtensions: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of file extensions to search (e.g., [".ts", ".tsx", ".js"]). If empty, searches all text files.',
          default: []
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Whether the search should be case-sensitive',
          default: false
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 100
        }
      },
      required: ['query']
    }
  }
];