# Snow CLI Extension with ACE Code Search

This extension provides seamless integration between VSCode and Snow AI CLI, featuring the powerful **ACE (Agentic Computer Environment) Code Search** system for intelligent code navigation.

## Features

### 🎯 Quick Access

- **One-click Terminal** - Button in editor toolbar to instantly launch Snow CLI
- **Auto-connection** - Automatic WebSocket connection to Snow CLI server
- **Real-time Sync** - Live editor context synchronization

### 🔍 ACE Code Search Integration

- **Go to Definition** - Leverage VSCode's language servers for precise symbol navigation
- **Find References** - Discover all symbol usages across your codebase
- **Document Symbols** - Get complete file outline with all functions, classes, and variables
- **Real-time Diagnostics** - Instant error and warning detection

### 🚀 Performance

- **Exponential Backoff** - Smart reconnection strategy
- **Context Caching** - Maintains state even when editor loses focus
- **Low Latency** - WebSocket communication for instant updates

## Requirements

Install Snow CLI globally:

```bash
npm install -g snow-ai
```

## Usage

### Basic Usage

1. Open any file in VSCode
2. Click the **Snow icon** button in the editor toolbar (top right)
3. A terminal opens with Snow CLI running
4. The extension automatically connects via WebSocket

#### Interface Preview

**English Interface:**

![English Interface](https://raw.githubusercontent.com/MayDay-wpf/snow-cli/main/VSIX/en.png)

**Chinese Interface:**

![Chinese Interface](https://raw.githubusercontent.com/MayDay-wpf/snow-cli/main/VSIX/zh.png)

### ACE Code Search Features

The extension enhances Snow CLI with VSCode's built-in language intelligence:

- **Symbol Navigation** - AI can request Go to Definition for any symbol
- **Reference Finding** - AI can find all references to functions/classes
- **Code Outline** - AI can get complete file structure
- **Error Detection** - AI receives real-time diagnostics

These features work automatically when Snow CLI uses ACE Code Search tools.

## Supported Languages

ACE Code Search supports:

- TypeScript/JavaScript
- Python
- Go
- Rust
- Java
- C#
- And more via VSCode language servers

## Extension Settings

This extension works out of the box with no configuration required.

Optional: Configure Snow CLI settings in `~/.snow/config.json`

## Architecture

```text
VSCode Extension (Port 9527)
    ↕ WebSocket
Snow CLI
    ↕ MCP Tools
ACE Code Search Engine
    ↕ Language Parsers
Your Codebase
```

## Known Issues

None currently. Please report issues on GitHub.

## Release Notes

### 0.3.0 - ACE Code Search Integration

**Major Update:**

- ✨ Added ACE Code Search integration
- 🎯 Go to Definition support via VSCode language servers
- 🔍 Find References across entire workspace
- 📋 Document symbol extraction
- 🔗 WebSocket message handlers for ACE features
- 📊 Enhanced diagnostic support

### 0.2.6

- Add automatic WebSocket reconnection with exponential backoff
- Improve connection stability
- Enhanced context caching for better reliability

---

## Learn More

- [Snow CLI GitHub](https://github.com/yourusername/snow-cli)
- [ACE Code Search Documentation](https://github.com/yourusername/snow-cli/blob/main/docs/ACE_CODE_SEARCH.md)

**Enjoy intelligent coding with Snow CLI + ACE Code Search!** 🚀
