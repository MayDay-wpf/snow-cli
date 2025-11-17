# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Every time you make a modification, try to compile with npm run build.

## Project Overview

**snow-ai** is an intelligent CLI assistant powered by AI, built with Ink (React for CLI) and TypeScript. The project enables conversational AI interactions in the terminal with support for Model Context Protocol (MCP) tools, session management, and streaming responses.

## Language Preference

**请一直使用中文交互** - Use Chinese for all interactions.

## Development Commands

### Build and Development

- `npm run build` - Compile TypeScript to `dist/`
- `npm run dev` - Watch mode compilation for iterative development
- `npm start` - Run the compiled CLI (`node dist/cli.js`)
- `npm test` - Run full quality gate: Prettier, XO lint, and AVA tests
- `npm run lint` - Run XO linter only
- `npm run format` - Format code with Prettier

### Running the CLI

After building, run `snow` directly if installed globally, or `node dist/cli.js` for local testing. Append `--help` to see available flags.

## Architecture

### Entry Points and Application Flow

- `source/cli.tsx` - CLI entry point using meow for argument parsing, renders the main App
- `source/app.tsx` - Root component managing view routing (welcome, chat, settings, API config, model config, MCP config)
- `source/ui/pages/ChatScreen.tsx` - Main chat interface handling streaming responses, session management, MCP tool calls, and file references

### Core Modules

#### API Layer (`source/api/`)

- `chat.ts` - OpenAI client wrapper with three modes:
  - `createChatCompletion` - Non-streaming with automatic tool calling loop
  - `createStreamingChatCompletion` - Streaming generator with inline tool execution and special markers (`__STREAM_ROUND_END__`, `__TOOL_CALL_START__`, `__TOOL_RESULT__`)
  - `createChatCompletionWithTools` - Limited-round tool calling for summaries
- `models.ts` - Type definitions for models

#### Utils (`source/utils/`)

- `apiConfig.ts` - Manages `~/.snow/config.json` (OpenAI settings) and `~/.snow/mcp-config.json` (MCP servers)
- `sessionManager.ts` - Session persistence in `~/.snow/sessions/`, auto-generates summaries using basicModel
- `mcpToolsManager.ts` - MCP tool collection and execution with 5-minute cache:
  - Built-in filesystem tools (always available)
  - User-configured MCP servers (probed on-demand, connected only during execution)
  - Tool naming: `serviceName-toolName` (e.g., `filesystem-read`, `myservice-customtool`)
- `fileUtils.ts` - Parse file references in messages (`@path/to/file.ts:10-20`)
- `commandExecutor.ts` - Command registry and execution framework
- `commands/` - Built-in commands: `clear.ts`, `resume.ts`, `mcp.ts`

#### MCP Integration (`source/mcp/`)

- `filesystem.ts` - Built-in filesystem service with tools: read, create, delete, list, exists, info

#### UI Components (`source/ui/components/`)

- `ChatInput.tsx` - User input with command support (prefix: `/`), file picker, history navigation
- `MessageList.tsx` - Message rendering with role-based styling
- `MarkdownRenderer.tsx` - Markdown rendering for assistant responses
- `SessionListScreen.tsx` - Session browsing and selection
- `MCPInfoPanel.tsx` - MCP service status and tool listing
- `PendingMessages.tsx` - Queue display for messages sent during streaming

#### UI Pages (`source/ui/pages/`)

- `ModelConfigScreen.tsx` - Model configuration with three input modes:
  - API model list selection (fetched from configured base URL)
  - Manual input option (⌨️ Manual Input in dropdown)
  - Direct manual input via 'M' key shortcut
  - Auto-fallback to manual input when API fetch fails

#### Hooks (`source/hooks/`)

- `useSessionSave.ts` - Auto-save user/assistant messages to session
- `useGlobalExit.ts` - Global exit notification handler

### Key Architectural Patterns

**Streaming Response Flow:**

1. User sends message → ChatScreen creates AbortController
2. `createStreamingChatCompletion` yields chunks with special markers
3. ChatScreen accumulates chunks until `__STREAM_ROUND_END__`, then commits to Static component
4. Tool calls are parsed from `__TOOL_CALL_START__...END__` markers and displayed immediately
5. Tool results update with `__TOOL_RESULT__...END__` markers
6. Final message saved to session via `useSessionSave`

**MCP Tool Execution:**

1. Tools cached for 5 minutes (avoids repeated connections)
2. Cache invalidated on config change or manual refresh
3. Built-in filesystem tools execute directly (no MCP connection)
4. External MCP tools connect only during execution, then disconnect

**Session Management:**

- Sessions auto-generate title/summary every 1st and 5th user message
- Uses `basicModel` for summary generation (fallback to simple truncation if unconfigured)
- Duplicate message detection prevents save loops (5-second window)

## Configuration Files

- `.snow/config.json` - OpenAI API key, base URL, models (advanced/basic), max context tokens
- `.snow/mcp-config.json` - MCP servers with URL or command-based transports, environment variables
- `.snow/sessions/*.json` - Individual chat sessions

## Code Style

- Use tabs for indentation (enforced by `.editorconfig`)
- PascalCase for React components, camelCase for utilities, SCREAMING_SNAKE_CASE for constants
- Prefer named exports over default exports (exception: page components)
- XO linter extends `xo-react`, Prettier config from `@vdemedes/prettier-config`
- Run `npm run format` before committing

## Testing

- Write AVA tests in `source/test/` with `*-test.ts` naming
- Mock external services (OpenAI API, filesystem) via dependency injection
- Use Ink testing library for component tests
- Example: `logger-test.ts`

## Commit Guidelines

Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, etc.). Recent history mixes English and Chinese; prefer concise English for summaries but adapt to existing patterns in the repo.

## Important Notes

- **Never commit** `.snow/` directory or API keys
- All file paths must be absolute (relative to project root)
- Session save is non-blocking (background Promises with error catching)
- ESC key interrupts streaming (aborts request, marks message as discontinued)
- Commands are registered via side-effect imports in ChatScreen (`import '../../utils/commands/clear.js'`)
- MCP tools use prefix-based naming to route to correct service

## Common Pitfalls

- Don't forget to refresh MCP cache after config changes (`refreshMCPToolsCache()`)
- Streaming responses must handle partial JSON in tool call buffers
- Session manager requires `currentSession` to be set before adding messages
- File references parsed client-side but validated against actual filesystem before sending to AI
- Tool execution errors are caught and converted to tool result messages (not thrown)
- ModelConfigScreen supports manual model input as fallback when API fetch fails - ensure error handling doesn't block user input
