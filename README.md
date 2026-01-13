<div align="center">

<img src="docs/images/logo.png" alt="Snow AI CLI Logo" width="200"/>

# snow-ai

[![npm version](https://img.shields.io/npm/v/snow-ai.svg)](https://www.npmjs.com/package/snow-ai)
[![npm downloads](https://img.shields.io/npm/dm/snow-ai.svg)](https://www.npmjs.com/package/snow-ai)
[![license](https://img.shields.io/npm/l/snow-ai.svg)](https://github.com/MayDay-wpf/snow-cli/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/snow-ai.svg)](https://nodejs.org/)

**English** | [中文](README_zh.md)

**QQ Group**: 910298558

_Agentic coding in your terminal_

</div>

## Thanks Developer

<a href="https://github.com/MayDay-wpf/snow-cli/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=MayDay-wpf/snow-cli" />
</a>


## Thanks Support

- [UUCode](https://www.uucode.org)

---

![alt text](docs/images/image.png)

## Documentation

- [Installation Guide](docs/usage/en/01.Installation%20Guide.md) - System requirements, installation (update, uninstall) steps, IDE extension installation
- [First Time Configuration](docs/usage/en/02.First%20Time%20Configuration.md) - API configuration, model selection, basic settings
- [Startup Parameters Guide](docs/usage/en/19.Startup%20Parameters%20Guide.md) - Command-line parameters explained, quick start modes, headless mode, async tasks, developer mode

### Advanced Configuration

- [Proxy and Browser Settings](docs/usage/en/03.Proxy%20and%20Browser%20Settings.md) - Network proxy configuration, browser usage settings
- [Codebase Setup](docs/usage/en/04.Codebase%20Setup.md) - Codebase integration, search configuration
- [Sub-Agent Configuration](docs/usage/en/05.Sub-Agent%20Configuration.md) - Sub-agent management, custom sub-agent configuration
- [Sensitive Commands Configuration](docs/usage/en/06.Sensitive%20Commands%20Configuration.md) - Sensitive command protection, custom command rules
- [Hooks Configuration](docs/usage/en/07.Hooks%20Configuration.md) - Workflow automation, hook types explanation, practical configuration examples
- [Theme Settings](docs/usage/en/08.Theme%20Settings.md) - Interface theme configuration, custom color schemes, simplified mode
- [Third-Party Relay Configuration](docs/usage/en/16.Third-Party%20Relay%20Configuration.md) - Claude Code relay, Codex relay, custom headers configuration

### Feature Guide

- [Command Panel Guide](docs/usage/en/09.Command%20Panel%20Guide.md) - Detailed description of all available commands, usage tips, shortcut key reference
- [Command Injection Mode](docs/usage/en/10.Command%20Injection%20Mode.md) - Execute commands directly in messages, syntax explanation, security mechanisms, use cases
- [Vulnerability Hunting Mode](docs/usage/en/11.Vulnerability%20Hunting%20Mode.md) - Professional security analysis, vulnerability detection, verification scripts, detailed reports
- [Headless Mode](docs/usage/en/12.Headless%20Mode.md) - Command line quick conversations, session management, script integration, third-party tool integration
- [Keyboard Shortcuts Guide](docs/usage/en/13.Keyboard%20Shortcuts%20Guide.md) - All keyboard shortcuts, editing operations, navigation control, rollback functionality
- [MCP Configuration](docs/usage/en/14.MCP%20Configuration.md) - MCP service management, configure external services, enable/disable services, troubleshooting
- [Async Task Management](docs/usage/en/15.Async%20Task%20Management.md) - Background task creation, task management interface, sensitive command approval, task to session conversion
- [Skills Command Detailed Guide](docs/usage/en/18.Skills%20Command%20Detailed%20Guide.md) - Skill creation, usage methods, Claude Code Skills compatibility, tool restrictions
- [LSP Configuration and Usage](docs/usage/en/19.LSP%20Configuration.md) - LSP config file, language server installation, ACE tool usage (definition/outline)
- [SSE Service Mode](docs/usage/en/20.SSE%20Service%20Mode.md) - SSE server startup, API endpoints explanation, tool confirmation flow, permission configuration, YOLO mode, client integration examples

---

## Development Guide

### Prerequisites

- **Node.js >= 16.x** (Requires ES2020 features support)
- npm >= 8.3.0

Check your Node.js version:

```bash
node --version
```

If your version is below 16.x, please upgrade first:

```bash
# Using nvm (recommended)
nvm install 16
nvm use 16

# Or download from official website
# https://nodejs.org/
```

### Build from Source

```bash
git clone https://github.com/MayDay-wpf/snow-cli.git
cd snow-cli
npm install
npm run link   # builds and globally links snow
# to remove the link later: npm run unlink
```

### IDE Extension Development

#### VSCode Extension

- Extension source located in `VSIX/` directory
- Download release: [mufasa.snow-cli](https://marketplace.visualstudio.com/items?itemName=mufasa.snow-cli)

#### JetBrains Plugin

- Plugin source located in `Jetbrains/` directory
- Download release: [JetBrains plugin](https://plugins.jetbrains.com/plugin/28715-snow-cli/edit)

### Project Structure

```
.snow/                      # User configuration directory
├── log/                    # Runtime logs (local, can be deleted)
├── profiles/               # Configuration profiles
├── sessions/               # Conversation history
├── snapshots/              # File snapshots
├── todos/                  # TODO lists
├── tasks/                  # Async tasks
├── task-logs/              # Async task logs
├── history/                # Command history
├── commands/               # Custom commands
├── hooks/                  # Workflow hooks
├── sse-daemons/            # SSE daemon processes
├── sse-logs/               # SSE service logs
├── usage/                  # Usage statistics
├── active-profile.json     # Current active profile
├── config.json             # API configuration
├── custom-headers.json     # Custom request headers
├── mcp-config.json         # MCP configuration
├── lsp-config.json         # LSP configuration
├── proxy-config.json       # Proxy settings
├── codebase.json           # Codebase index settings
├── sub-agents.json         # Sub-agent configuration
├── sensitive-commands.json # Sensitive command rules
├── theme.json              # Theme settings
├── language.json           # Language settings
├── history.json            # History settings
└── system-prompt.json      # Custom system prompts
```

---

## QQ Group

![alt text](docs/images/qq_group_qr.jpg)


---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MayDay-wpf/snow-cli&type=Date)](https://star-history.com/#MayDay-wpf/snow-cli&Date)
