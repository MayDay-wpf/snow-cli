# SNOW.md - Project Documentation

## Project Name

**snow-ai** – Intelligent AI-powered command-line assistant

## Overview

snow-ai brings conversational AI workflows straight into the terminal. It combines a React-based (Ink) UI with multiple AI backends so developers can chat, run commands, and execute Model Context Protocol (MCP) tools without leaving their shell. Sessions persist locally, integrate with IDE diagnostics, and support file-aware prompts for precise collaboration.

Beyond simple chat, the CLI orchestrates profile-based API settings, tool approval flows, sub-agent delegation, and workspace-aware diffs. It targets power users who want the flexibility of open-source tooling with the ergonomics of a polished assistant that understands files, commands, and IDE state.

## Technology Stack

- **Language/Runtime**: TypeScript (ESM), Node.js ≥ 16
- **Frameworks/UI**: Ink (React for CLIs), @inkjs/ui, Chalk/cli-highlight for styling
- **Key Dependencies**: @modelcontextprotocol/sdk, puppeteer-core, ws, meow, string-width, tiktoken, diff
- **Build/Test Tools**: TypeScript compiler, Prettier, XO, AVA, Ink Testing Library; packaged via npm

## Project Structure

```text
snow-cli/
├── source/
│   ├── cli.tsx                # CLI entry (meow parsing, update handling)
│   ├── app.tsx                # Root Ink router/state container
│   ├── api/                   # Provider clients (OpenAI, Anthropic, Gemini)
│   ├── ui/
│   │   ├── components/        # Reusable Ink widgets (ChatInput, lists, tool panels)
│   │   └── pages/             # Full-screen views (ChatScreen, Config screens, Welcome)
│   ├── utils/                 # Config/session/tool managers, command executors, snapshots
│   ├── hooks/                 # Shared React hooks (session save, navigation, resize)
│   ├── mcp/                   # Built-in MCP servers, types, and utilities
│   ├── agents/                # Specialized agent implementations (e.g., compact agent)
│   ├── constants/, types/     # Shared enums, colors, and TypeScript contracts
│   └── test/                  # AVA test files (sample logger test)
├── dist/                      # Compiled JavaScript output (cli.js entry)
├── docs/, AGENTS.md, CLAUDE.md # Additional guidance and design docs
├── VSIX/, JetBrains/, chrome/ # Editor/browser integrations and packages
├── scripts/                   # Helper scripts (packaging, release, etc.)
├── package.json, tsconfig.json, readme*.md, CHANGELOG.md
└── SNOW.md                    # This document
```

## Key Features

- Multi-provider AI chat (OpenAI, Anthropic, Google Gemini) with profile switching
- Ink-based conversational UI with streaming output, diff viewers, file pickers, and todo visualization
- Model Context Protocol integration for filesystem access, bash execution, ACE code search, web search, and sub-agents
- Session persistence with auto-summarization, rollback checkpoints, and usage tracking
- IDE connectivity (VSCode, JetBrains) for diagnostics, file references, and editor-driven actions
- Extensive configuration surfaces (system prompt, headers, proxies, profiles, sub-agents)

## Getting Started

### Prerequisites

- Node.js 16+ and npm 7+
- API credentials for at least one provider (OpenAI/Anthropic/Gemini)
- Terminal with ANSI color support; optional VSCode/JetBrains plugin for IDE features

### Installation

```bash
# Global installation
npm install --global snow-ai

# From source
git clone https://github.com/MayDay-wpf/snow-cli.git
cd snow-cli
npm install
npm run build
npm start
```

### Usage

```bash
snow           # launch CLI UI
snow --update  # check for newer version
snow -c        # resume last session
```

In-chat commands start with `/` (e.g., `/init`, `/clear`, `/resume`, `/mcp`, `/yolo`, `/ide`, `/compact`, `/export`, `/review`, `/usage`). Reference files with `@path/to/file.ts:10-20` to stream code into the conversation. Keyboard shortcuts include `ESC` to stop streaming, double `ESC` for rollback, and `Shift+Tab` to toggle YOLO (auto-approve tools).

## Development

### Available Scripts

- `npm run build` – Compile TypeScript into `dist/`
- `npm run dev` – TypeScript watch mode
- `npm start` – Execute compiled CLI locally
- `npm test` – Prettier check, XO lint, AVA tests
- `npm run lint` – XO only
- `npm run format` – Prettier write

### Development Workflow

1. Install dependencies with `npm install` and run `npm run dev` during active work.
2. Keep tests in `source/test/` using AVA; mock external APIs where possible.
3. Enforce formatting/linting before commits (`npm run format` + `npm run lint`).
4. Run `npm run build` and `npm test` prior to publishing or packaging extensions.
5. Update profile/config files via `configManager` utilities or UI screens for multi-provider validation.

## Configuration

- **Profiles**: Stored under `~/.snow/profiles/`; active profile tracked in `~/.snow/active-profile.txt`.
- **API Config**: JSON schema with `baseUrl`, `apiKey`, `requestMethod`, model names, token budgets, optional Anthropic "thinking" settings, and compact model parameters.
- **MCP Services**: Defined in `~/.snow/mcp-config.json` listing commands or transports per server.
- **Sub-Agents**: Managed via `~/.snow/sub-agents.json` with tool whitelists.
- **Custom Headers/System Prompt**: `~/.snow/custom-headers.json` and `~/.snow/system-prompt.txt`.
- **Sessions & Snapshots**: `~/.snow/sessions/` and `~/.snow/snapshots/` track conversation history and rollback checkpoints.
- **Environment Variables**: `SNOW_CONFIG_DIR`, `SNOW_SESSION_DIR`, `SNOW_PROFILES_DIR`, `SNOW_ACTIVE_PROFILE`, `HTTP(S)_PROXY` override defaults.

## Architecture

- **CLI Entry (`source/cli.tsx`)** uses `meow` for flag parsing, update checks, and dispatches into the React UI.
- **App Shell (`source/app.tsx`)** chooses between Welcome, Chat, Config, and utility screens while holding global state (profiles, sessions, tool cache).
- **API Layer (`source/api/`)** unifies chat/response/gemini workflows into a streaming interface that emits structured markers for tool calls and results.
- **Session & Tool Managers (`source/utils/`)** persist history, manage checkpoints, execute commands/tools, compress context, and coordinate MCP connections.
- **MCP Services (`source/mcp/`)** expose filesystem, bash, ACE search, web search, todo, diagnostics, and sub-agent capabilities to the assistant.
- **IDE Integration** hooks relay diagnostics and file metadata via VSCode/JetBrains plugins, enabling contextual actions and automatic references.

## Contributing

- Follow Conventional Commits (`feat:`, `fix:`, `docs:`, etc.).
- Create feature branches, run `npm test` before pushing, and document verification steps in PRs.
- Update documentation (README/SNOW.md/CLAUDE.md) when changing workflows or capabilities.
- Keep secrets out of commits (`.snow/` remains local-only).

## License

MIT License — see `LICENSE` for full terms.
