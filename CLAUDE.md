# CLAUDE.md

# 保持用中文回复，但是代码注释等需要和项目语言一致

# 永远不要写总结 md 文档

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Snow AI is an intelligent AI-powered CLI tool built with React (Ink), TypeScript, and the Model Context Protocol (MCP). It provides an interactive terminal interface for AI-assisted development with features like session management, file snapshots/rollback, VSCode integration, and context compression.

## Build and Development Commands

```bash
# Build the project (TypeScript compilation)
npm run build

# Development mode with watch (auto-recompiles on changes)
npm run dev

# Run the CLI locally (requires build first)
npm start

# Linting
npm run lint

# Format code
npm run format

# Run tests
npm test
```

### Installation Speed Optimization

The project includes `.npmrc` configuration optimized for faster dependency installation:

- **Mirror Registry**: Uses `https://registry.npmmirror.com` for faster downloads in China
- **Parallel Downloads**: `maxsockets=10` enables concurrent package downloads
- **Offline Cache**: `prefer-offline=true` prioritizes local cache to reduce network requests
- **Disabled Audits**: `audit=false` and `fund=false` skip unnecessary checks during install
- **Network Resilience**: Configured retry policies and extended timeout for unreliable connections

For users outside China, you can modify the registry in `.npmrc`:

```bash
# Use official npm registry
registry=https://registry.npmjs.org

# Or use other mirrors
# registry=https://registry.npm.taobao.org
```

## Architecture

### Core Application Structure

- **Entry Point**: `source/cli.tsx` - Initializes the Ink app, handles CLI arguments (`--update`, `--version`), and manages process lifecycle
- **Main App**: `source/app.tsx` - Root React component managing navigation between views (welcome, chat, settings, config screens)
- **Chat Interface**: `source/ui/pages/ChatScreen.tsx` - Main conversational interface with streaming, tool execution, and session management

### Key Architectural Components

#### 1. **API Abstraction Layer** (`source/api/`)

- `chat.ts` - Unified chat interface supporting multiple providers (OpenAI, Anthropic, Gemini)
- `anthropic.ts`, `gemini.ts`, `responses.ts` - Provider-specific implementations
- `models.ts` - Model configuration and capabilities
- `systemPrompt.ts` - Default system prompts for AI interactions

The API layer abstracts different AI providers behind a common interface. Messages are converted from the internal `ChatMessage` format to provider-specific formats. Custom system prompts can override defaults.

#### 2. **MCP (Model Context Protocol)** (`source/mcp/`)

Built-in MCP servers providing tool capabilities:

- `filesystem.ts` - File operations (read, write, edit, search, glob)
- `bash.ts` - Terminal command execution
- `todo.ts` - Todo list management per session
- `aceCodeSearch.ts` - Advanced code search with semantic understanding

External MCP servers can be configured via `~/.snow/config.json`. The `mcpToolsManager.ts` handles discovery, connection, and tool execution for both built-in and external servers.

#### 3. **Session Management** (`source/utils/sessionManager.ts`)

Sessions are stored in `~/.snow/sessions/` as JSON files. Each session contains:

- Unique UUID identifier
- Messages array (with timestamps)
- Title and summary
- Message count

Sessions persist conversation history and can be resumed via the `/resume` command.

#### 4. **Snapshot & Rollback System**

Two complementary systems for file versioning:

- **CheckpointManager** (`source/utils/checkpointManager.ts`): Creates snapshots before AI operations, enabling rollback when user hits ESC during generation
- **WorkspaceSnapshot** (`source/utils/workspaceSnapshot.ts`): Git-like version control tracking file changes across conversation turns

#### 5. **VSCode Integration** (`source/utils/vscodeConnection.ts`)

WebSocket server (port 9527) enabling bi-directional communication with VSCode extension:

- Receives editor context (active file, selection, diagnostics)
- Sends commands back to VSCode
- Supports multiple concurrent connections

Enable via `/ide` command. Extension VSIX located in `VSIX/` directory.

#### 6. **Context Compression** (`source/utils/contextCompressor.ts`)

Uses a separate "compact model" to summarize conversation history when context window fills. Triggered via `/compact` command. Requires `compactModel` configuration in config.

#### 7. **Custom Hooks** (`source/hooks/`)

React hooks managing complex state:

- `useConversation.ts` - Core conversation loop with tool execution
- `useCommandHandler.ts` - Slash command processing
- `useStreamingState.ts` - Streaming message state
- `useSessionSave.ts` - Automatic session persistence
- `useToolConfirmation.ts` - User confirmation for tool execution (unless `/yolo` mode)
- `useVSCodeState.ts` - VSCode connection state
- `useKeyboardInput.ts` - Complex keyboard handling (ESC for stop/rollback)

### Command System (`source/utils/commands/`)

Slash commands registered via `commandExecutor.ts`:

- `/clear` - Create new session
- `/resume` - Load previous session
- `/mcp` - View MCP server status
- `/yolo` - Toggle auto-approval of tools
- `/init` - Generate project documentation (AGENTS.md)
- `/ide` - Connect to VSCode extension
- `/compact` - Compress conversation context

Commands are dynamically registered and return `CommandResult` with actions.

## Configuration

Config stored at `~/.snow/config.json`:

```json
{
	"snowcfg": {
		"baseUrl": "https://api.openai.com/v1",
		"apiKey": "your-api-key",
		"requestMethod": "responses",
		"advancedModel": "gpt-4",
		"basicModel": "gpt-3.5-turbo",
		"maxContextTokens": 32000,
		"maxTokens": 4096,
		"anthropicBeta": false,
		"compactModel": {
			"baseUrl": "https://api.openai.com/v1",
			"apiKey": "your-api-key",
			"modelName": "gpt-4-mini"
		}
	}
}
```

MCP servers configured under `mcpServers` key in same file.

## Key Design Patterns

1. **Provider Abstraction**: Single chat interface supports OpenAI, Anthropic, Gemini via adapters
2. **Tool Protocol**: MCP-based tools with standardized execution flow via `mcpToolsManager`
3. **Streaming Architecture**: All AI responses stream incrementally with `useStreamingState`
4. **Component-Hook Separation**: UI components are pure, business logic lives in hooks
5. **Session Persistence**: All conversations auto-save to disk with incremental updates
6. **File Safety**: Checkpoint system prevents data loss from interrupted operations

## Development Notes

- TypeScript compiled from `source/` to `dist/` (not committed to git)
- Uses `@sindresorhus/tsconfig` as base
- Ink v5 for terminal UI rendering
- XO for linting with React preset
- All modules use ES modules (`.js` extensions in imports, `"type": "module"` in package.json)
- Custom headers can be configured for API requests via Custom Headers screen

## Testing

When adding features:

1. Test with multiple AI providers (OpenAI, Anthropic, Gemini)
2. Verify session persistence and resume functionality
3. Test snapshot/rollback with file operations
4. Validate VSCode integration if touching connection logic
5. Check tool execution in both normal and `/yolo` modes
