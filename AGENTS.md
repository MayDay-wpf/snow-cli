# Snow CLI

An intelligent AI-powered command-line assistant that brings advanced AI capabilities directly into your terminal.

## Overview

Snow CLI is a terminal-first AI assistant designed for developers who want powerful AI assistance without leaving the command line. It provides lightweight access to multiple AI models (OpenAI, Anthropic, Gemini, and any OpenAI-compatible APIs) with built-in tools for file operations, shell commands, web search, and more. The project emphasizes extensibility through MCP (Model Context Protocol) support and seamless IDE integration with VSCode and JetBrains plugins.

Snow CLI enables developers to query and edit large codebases, generate applications from natural language, debug issues with intelligent suggestions, and automate operational tasks - all within their familiar terminal environment. It features conversation checkpointing, multiple configuration profiles, custom system prompts, automatic file snapshots for rollback, and intelligent token caching.

## Technology Stack

- **Language/Runtime**: TypeScript (compiled to ESM), Node.js >= 16.x
- **UI Framework**: React + Ink (terminal UI rendering)
- **Build System**: 
  - TypeScript Compiler (tsc)
  - esbuild (bundling)
  - Custom build scripts (build.mjs)
- **Key Dependencies**:
  - `@modelcontextprotocol/sdk` - MCP integration
  - `@inkjs/ui` - Terminal UI components
  - `ink` - React for CLIs
  - `meow` - CLI argument parsing
  - `chalk` - Terminal styling
  - `tiktoken` - Token counting
  - `puppeteer-core` - Web scraping capabilities
  - `markdown-it` / `marked-terminal` - Markdown rendering in terminal
  - `sql.js` - Database support
  - `chokidar` - File system watching
  - Document parsers: `pdf-parse`, `mammoth`, `pptx-parser`, `xlsx`
- **Testing & Quality**:
  - `ava` - Test runner
  - `xo` - Linting (ESLint wrapper)
  - `prettier` - Code formatting

## Project Structure

```
snow-cli/
├── source/                      # TypeScript source code
│   ├── agents/                  # AI agent implementations
│   │   ├── codebaseIndexAgent.ts    # Codebase indexing
│   │   ├── codebaseReviewAgent.ts   # Code review agent
│   │   ├── compactAgent.ts          # Context compaction
│   │   ├── promptOptimizeAgent.ts   # Prompt optimization
│   │   ├── reviewAgent.ts           # General review agent
│   │   └── summaryAgent.ts          # Summary generation
│   ├── api/                     # API client implementations
│   │   ├── anthropic.ts         # Claude API client
│   │   ├── gemini.ts            # Gemini API client
│   │   ├── chat.ts              # OpenAI chat completions
│   │   ├── responses.ts         # OpenAI responses API
│   │   ├── embedding.ts         # Embedding models
│   │   ├── models.ts            # Model management
│   │   ├── systemPrompt.ts      # System prompt handling
│   │   └── types.ts             # API type definitions
│   ├── mcp/                     # MCP tool implementations
│   │   ├── aceCodeSearch.ts     # ACE code search tools
│   │   ├── askUserQuestion.ts   # Interactive user prompts
│   │   ├── bash.ts              # Terminal command execution
│   │   ├── codebaseSearch.ts    # Codebase search utilities
│   │   ├── filesystem.ts        # File system operations
│   │   ├── ideDiagnostics.ts    # IDE integration diagnostics
│   │   ├── notebook.ts          # Code memory/notes
│   │   ├── subagent.ts          # Sub-agent delegation
│   │   ├── todo.ts              # TODO management
│   │   ├── websearch.ts         # Web search capabilities
│   │   ├── types/               # MCP type definitions
│   │   └── utils/               # MCP utilities
│   ├── ui/                      # Terminal UI components
│   │   ├── components/          # Reusable UI components
│   │   ├── contexts/            # React contexts
│   │   ├── pages/               # Screen components
│   │   │   ├── WelcomeScreen.tsx
│   │   │   ├── ChatScreen.tsx
│   │   │   ├── HeadlessModeScreen.tsx
│   │   │   ├── TaskManagerScreen.tsx
│   │   │   ├── MCPConfigScreen.tsx
│   │   │   ├── SystemPromptConfigScreen.tsx
│   │   │   ├── CustomHeadersScreen.tsx
│   │   │   ├── SubAgentConfigScreen.tsx
│   │   │   ├── SubAgentListScreen.tsx
│   │   │   ├── HooksConfigScreen.tsx
│   │   │   ├── SensitiveCommandConfigScreen.tsx
│   │   │   ├── CustomThemeScreen.tsx
│   │   │   ├── ThemeSettingsScreen.tsx
│   │   │   ├── LanguageSettingsScreen.tsx
│   │   │   ├── ProxyConfigScreen.tsx
│   │   │   ├── CodeBaseConfigScreen.tsx
│   │   │   └── ConfigScreen.tsx
│   │   └── themes/              # UI theming
│   ├── hooks/                   # React hooks
│   │   ├── conversation/        # Conversation management
│   │   ├── input/               # Input handling
│   │   ├── integration/         # External integrations
│   │   ├── picker/              # File/option pickers
│   │   ├── session/             # Session management
│   │   └── ui/                  # UI utilities
│   ├── utils/                   # Utility functions
│   │   ├── codebase/            # Codebase analysis
│   │   ├── commands/            # Command processing
│   │   ├── config/              # Configuration management
│   │   ├── core/                # Core utilities
│   │   ├── execution/           # Execution utilities
│   │   ├── session/             # Session utilities
│   │   ├── task/                # Task management
│   │   ├── ui/                  # UI utilities
│   │   └── index.ts             # Utilities barrel export
│   ├── i18n/                    # Internationalization
│   ├── types/                   # Global type definitions
│   ├── app.tsx                  # Main application component
│   ├── cli.tsx                  # CLI entry point
│   └── test/                    # Test files
├── bundle/                      # Production bundle (generated)
│   ├── cli.mjs                  # Bundled executable
│   ├── sql-wasm.wasm            # SQL.js WebAssembly
│   ├── tiktoken_bg.wasm         # Tiktoken WebAssembly
│   └── pdf.worker.mjs           # PDF.js worker
├── dist/                        # TypeScript compilation output (generated)
├── scripts/                     # Build and setup scripts
│   └── postinstall.cjs          # Post-installation script
├── docs/                        # Documentation and images
│   ├── images/                  # Screenshots and assets
│   └── usage/                   # Usage guides
├── VSIX/                        # VSCode extension
├── JetBrains/                   # JetBrains plugin
├── build.mjs                    # esbuild configuration
├── build-ncc.mjs                # Alternative bundler config
├── build-shim.js                # Build shim script
├── package.json                 # npm package configuration
├── tsconfig.json                # TypeScript configuration
├── .editorconfig                # Editor configuration
├── .prettierignore              # Prettier ignore rules
├── .gitignore                   # Git ignore rules
├── LICENSE                      # Apache License 2.0
├── README.md                    # English documentation
├── README_zh.md                 # Chinese documentation
└── CHANGELOG.md                 # Version history
```

## Key Features

### Multi-Model AI Support
- Compatible with OpenAI, Anthropic Claude, Google Gemini, and any OpenAI-compatible API
- Flexible configuration with three model slots (Advanced, Basic, Compact)
- Automatic model discovery from provider APIs
- Support for custom base URLs and API keys

### Code Understanding & Generation
- Query and edit large codebases with AI assistance
- Multi-file context awareness
- Generate new applications from natural language
- Debug and troubleshoot with intelligent suggestions
- ACE code search integration for symbol definitions and references

### Built-in MCP Tools
- **Filesystem Operations**: Read, create, edit files with search-and-replace or line-based editing
- **Terminal Execution**: Run shell commands and scripts with sensitive command detection
- **Code Search**: Semantic symbol search, text pattern matching, file outline
- **Web Search**: DuckDuckGo integration with page fetching
- **IDE Integration**: VSCode and JetBrains diagnostics support
- **Notebook**: Record fragile code notes and constraints
- **TODO Management**: Track tasks across sessions
- **Sub-agent Delegation**: Explore, Plan, and General Purpose agents

### Advanced Capabilities
- **Multiple Configuration Profiles**: Switch between different API setups
- **Conversation Checkpointing**: Save and resume sessions with `/resume`
- **Custom System Prompts**: Tailor AI behavior
- **File Snapshots**: Automatic rollback for AI-made changes
- **Yolo Mode**: Unattended execution for trusted operations
- **Token Caching**: Optimize usage with intelligent caching
- **Background Task Management**: Run long-running operations
- **Custom Hooks**: Configure automation hooks
- **Custom Themes**: Personalize the terminal UI
- **Sensitive Command Detection**: Confirmation mechanism for risky commands

### IDE Integration
- VSCode extension for seamless workflow
- JetBrains plugin support
- Real-time diagnostics display
- File selection via drag-and-drop

## Getting Started

### Prerequisites

- Node.js version 16 or higher
- npm >= 8.3.0
- macOS, Linux, or Windows

### Check Your Node.js Version

```bash
node --version
```

If your version is below 16.x, upgrade:

```bash
# Using nvm (recommended)
nvm install 16
nvm use 16

# Or download from official website
# https://nodejs.org/
```

### Installation

#### Install globally with npm

```bash
npm install -g snow-ai
```

#### Build from source

```bash
git clone https://github.com/MayDay-wpf/snow-cli
cd snow-cli
npm install
npm run link   # builds and globally links `snow`
# to remove the link later: npm run unlink
```

### IDE Extensions

#### VSCode Extension

- Download [snow-cli-x.x.x.vsix](https://github.com/MayDay-wpf/snow-cli/releases/tag/vsix)
- Open VSCode → Extensions → Install from VSIX... → select downloaded file

#### JetBrains Plugin

- Download [JetBrains plugins](https://github.com/MayDay-wpf/snow-cli/releases/tag/jetbrains)
- Follow JetBrains plugin installation instructions

### Basic Usage

```bash
# Start in current directory
snow

# Update to latest version
snow --update

# Check version
snow --version

# Resume latest conversation
snow -c

# Start with Yolo mode enabled
snow --yolo

# Continue last session with Yolo mode
snow --c-yolo
```

## Development

### Available Scripts

```bash
# Build the project (TypeScript compilation + bundling)
npm run build

# Build TypeScript only
npm run build:ts

# Build bundle only (requires compiled TypeScript)
npm run build:bundle

# Development mode with TypeScript watch
npm run dev

# Start the CLI from bundle
npm start

# Link for local development
npm run link

# Unlink global installation
npm run unlink

# Run tests (format check + linting + unit tests)
npm test

# Lint code with xo
npm run lint

# Format code with prettier
npm run format
```

### Development Workflow

1. **Setup Development Environment**:
   ```bash
   git clone https://github.com/MayDay-wpf/snow-cli
   cd snow-cli
   npm install
   ```

2. **Make Changes**: Edit TypeScript files in `source/` directory

3. **Development Mode**: Run `npm run dev` to watch for changes

4. **Build**: Run `npm run build` to compile and bundle

5. **Test Locally**: Run `npm run link` to test globally as `snow` command

6. **Test & Lint**: Run `npm test` to verify code quality

7. **Unlink**: Run `npm run unlink` when done testing

### Build Process

The build process uses a two-step approach:

1. **TypeScript Compilation** (`tsc`):
   - Compiles `source/` to `dist/` directory
   - Uses configuration from `@sindresorhus/tsconfig`
   - Outputs ES modules

2. **Bundling** (`build.mjs` with esbuild):
   - Bundles compiled JavaScript from `dist/cli.js`
   - Creates single executable `bundle/cli.mjs`
   - Targets Node.js 16+ with ES module format
   - Externalizes Node.js built-in modules and native dependencies (sharp)
   - Copies required WASM files (sql.js, tiktoken, pdf.js worker)
   - Adds CommonJS compatibility shims for `require`, `__filename`, `__dirname`

## Configuration

### API & Model Settings

After starting Snow CLI, configure your AI provider:

- **Profile**: Create/switch between multiple configurations
- **Base URL**: API endpoint (e.g., `https://api.openai.com/v1`)
- **API Key**: Authentication key
- **Request Method**: Chat Completions / Responses / Gemini / Anthropic
- **Model Configuration**: Advanced / Basic / Compact model slots
- **Max Context Tokens**: Model's context window size
- **Max Tokens**: Maximum tokens per response

### System Files

All Snow CLI files are stored in `~/.snow/`:

```
.snow/
├── log/                    # Runtime logs (safe to delete)
├── profiles/               # API/model configurations
├── sessions/               # Conversation history
├── snapshots/              # File backups for rollback
├── todo/                   # Persisted TODO lists
├── active-profile.txt      # Current profile name
├── config.json             # Main configuration
├── custom-headers.json     # Custom HTTP headers
├── mcp-config.json         # MCP server configuration
└── system-prompt.txt       # Custom system prompt
```

### Proxy & Browser Settings

Configure in the settings menu:
- Automatic system proxy detection
- Browser selection for web search (Edge/Chrome)
- Custom proxy port

### Custom System Prompts

Edit custom system prompts to supplement Snow's built-in behavior:
- Opens in system text editor (Notepad on Windows, default editor on macOS/Linux)
- Requires CLI restart after saving

### MCP Configuration

Configure Model Context Protocol servers in JSON format (Cursor-compatible):
- Add custom tools and capabilities
- Same editing workflow as system prompts
- Use `/mcp` command to check connection status

## Architecture

### High-Level Architecture

Snow CLI follows a modular architecture:

1. **CLI Entry Point** (`cli.tsx`):
   - Node.js version check
   - Command-line argument parsing
   - Loading indicator
   - Application bootstrap

2. **Application Layer** (`app.tsx`):
   - React-based UI with Ink rendering
   - Screen routing and navigation
   - Global state management
   - Exit handling

3. **UI Layer** (`source/ui/`):
   - Terminal UI components built with React + Ink
   - Multiple screens: Welcome, Chat, Headless, Task Manager, Config screens
   - Sub-agent configuration and management screens
   - Theming and styling with custom theme support

4. **API Layer** (`source/api/`):
   - Multi-provider AI client implementations
   - Request/response handling
   - Model management
   - Token counting and optimization

5. **MCP Tool Layer** (`source/mcp/`):
   - Tool implementations following MCP protocol
   - Filesystem operations, code search, web search
   - IDE integration, notebook, TODO management
   - Sub-agent delegation system

6. **Agent Layer** (`source/agents/`):
   - Specialized AI agents for specific tasks
   - Codebase indexing and review
   - Context compaction
   - Summary generation

7. **Utilities Layer** (`source/utils/`):
   - Configuration management
   - Session and task management
   - Execution utilities
   - Core utilities for process management

### Key Design Patterns

- **Lazy Loading**: UI components are lazy-loaded to improve startup time
- **MCP Protocol**: Standardized tool interface for AI interaction
- **Sub-Agent Pattern**: Delegation to specialized agents (Explore, Plan, General Purpose)
- **Snapshot System**: Automatic file backup for safe rollback
- **Session Management**: Conversation checkpointing and resumption
- **Hooks System**: Customizable automation hooks for workflow integration

## Slash Commands

Available slash commands in the chat interface:

- `/init` - Build project documentation `AGENTS.md`
- `/clear` - Create a new session
- `/resume` - Restore conversation history
- `/mcp` - Check MCP connection status and reconnect
- `/yolo` - Toggle unattended mode (auto-approve all tool calls)
- `/ide` - Manually connect to IDE
- `/compact` - Compress context (use sparingly)

## Keyboard Shortcuts

- **Windows**: `Alt+V` - Paste image
- **macOS/Linux**: `Ctrl+V` - Paste image (with prompt)
- `Ctrl+L` - Clear input from cursor to left
- `Ctrl+R` - Clear input from cursor to right
- `Ctrl+Enter` - Insert line break
- `Enter` - Submit message
- `Shift+Tab` - Toggle Yolo mode
- `ESC` - Stop AI generation
- **Double-click `ESC`** - Rollback conversation with file checkpoints

## Contributing

We welcome contributions from the community!

### How to Contribute

1. **Report Bugs**: Open issues on [GitHub](https://github.com/MayDay-wpf/snow-cli/issues)
2. **Suggest Features**: Propose new capabilities or improvements
3. **Submit Code**: Fork the repository and submit pull requests
4. **Improve Documentation**: Help make docs clearer and more comprehensive
5. **Share MCP Servers**: Create and share custom tool integrations

### Guidelines

- Follow the existing code style (enforced by xo and prettier)
- Write tests for new features
- Update documentation for user-facing changes
- Test across platforms (Windows, macOS, Linux) when possible

## Resources

- **GitHub**: [https://github.com/MayDay-wpf/snow-cli](https://github.com/MayDay-wpf/snow-cli)
- **NPM Package**: [https://www.npmjs.com/package/snow-ai](https://www.npmjs.com/package/snow-ai)
- **Releases**: [https://github.com/MayDay-wpf/snow-cli/releases](https://github.com/MayDay-wpf/snow-cli/releases)
- **Issues**: [https://github.com/MayDay-wpf/snow-cli/issues](https://github.com/MayDay-wpf/snow-cli/issues)

## License

Apache License 2.0

Copyright (c) 2024 Mufasa

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

---

<p align="center">
  <strong>Built with ❤️ by the open source community</strong><br>
  <em>Terminal-first AI assistance for developers</em>
</p>
