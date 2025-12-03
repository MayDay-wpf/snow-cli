<div align="center">

<img src="docs/images/logo.png" alt="Snow AI CLI Logo" width="200"/>

# snow-ai

**English** | [中文](README_zh.md)

_An intelligent AI-powered CLI tool for developers_

</div>

---

## Requirements

- **Node.js >= 16.x** (Required for ES2020 features)
- npm >= 8.3.0

### Check Your Node.js Version

```bash
$ node --version
```

If your version is below 16.x, please upgrade:

```bash
# Using nvm (recommended)
$ nvm install 16
$ nvm use 16

# Or download from official website
# https://nodejs.org/
```

## Installation

```bash
$ npm install -g snow-ai
```

You can also clone and build from source: https://github.com/MayDay-wpf/snow-cli

### Install VSCode Extension

- Download [snow-cli-x.x.x.vsix](https://github.com/MayDay-wpf/snow-cli/releases/tag/vsix)

- Open VSCode, click `Extensions` -> `Install from VSIX...` -> select `snow-cli-0.2.6.vsix`

### Install JetBrains Plugin

- Download [JetBrains/build/distributions](https://github.com/MayDay-wpf/snow-cli/tree/main/JetBrains/build/distributions)

## Available Commands

- **Start**: `$ snow`
- **Update**: `$ snow --update`
- **Version**: `$ snow --version`
- **Resume**: `$ snow -c` - Restore the latest conversation history (fully compatible with Claude Code)

## API & Model Settings

In version `v0.3.2` and later, all official SDKs have been removed (they were too heavy), so the configuration is slightly different. After starting, enter `API & Model Settings` to see the following options:

- **Profile** - Switch or create new configurations. Snow now supports saving multiple API and model schemes
- **Base URL** - Request endpoint. Since official SDKs were removed, OpenAI and Anthropic require `/v1` suffix, Gemini requires `/v1beta`
- **API Key** - Your API key
- **Request Method** - Choose based on your needs: `Chat Completions`, `Responses`, `Gemini`, or `Anthropic`
- **Anthropic Beta** - When checked, Anthropic requests will automatically include `beta=true` parameter
- **Advanced Model**, **Basic Model**, **Compact Model** - Set the high-performance model for tasks, small model for summarization, and compact model for context compression. All three models use the configured `BaseURL` and `API Key`. The system automatically fetches available models from the `/models` endpoint with filtering support. For APIs with incomplete model lists, use `Manual Input (Enter model name)` to specify the model name
- **Max Context Tokens** - The model's maximum context window, used for calculating context percentage. For example, Gemini typically has 1M context, so enter `1000000`. This parameter only affects UI calculations, not actual model context
- **Max Tokens** - This is critical and will be directly added to API requests as the `max_tokens` parameter

![alt text](docs/images/image.png)

## Proxy & Browser Settings

Configure system proxy port and search engine for web search. In most cases, this doesn't need modification as the app will automatically use system proxy. The app automatically detects available search engines (Edge/Chrome) unless you've manually changed their installation paths.

![alt text](docs/images/image-1.png)

## System Prompt Settings

Customize your system prompt. Note that this supplements Snow's built-in system prompt rather than replacing it. When you set a custom system prompt, Snow's default prompt is downgraded to a user message and appended to the first user message. On Windows, the app automatically opens Notepad; on macOS/Linux, it uses the system's default terminal text editor. After editing and saving, Snow will close and prompt you to restart: `Custom system prompt saved successfully! Please use 'snow' to restart!`

## Custom Headers Settings

Add custom request headers. Note that you can only add headers, not override Snow's built-in headers.

## MCP Settings

Configure MCP services. The method is identical to setting system prompts, and the JSON format matches Cursor's format.

## Getting Started - Start Conversation

Once everything is configured, enter the conversation page by clicking `Start`.

- If you launch Snow from VSCode or other editors, Snow will automatically connect to the IDE using the `Snow CLI` plugin. You'll see a connection message. The plugins are published online - search for `Snow CLI` in the plugin marketplace to install.

![alt text](docs/images/image-2.png)

### File Selection & Commands

- Use `@` to select files. In VSCode, you can also hold `Shift` and drag files for the same effect
- Use `/` to view available commands:
- `/init` - Build project documentation `AGENTS.md`
  - `/clear` - Create a new session
  - `/resume` - Restore conversation history
  - `/mcp` - Check MCP connection status and reconnect
  - `/yolo` - Unattended mode (all tool calls execute without confirmation - use with caution)
  - `/ide` - Manually connect to IDE (usually automatic if plugin is installed)
  - `/compact` - Compress context (rarely used as compression reduces AI quality)

### Keyboard Shortcuts

- **Windows**: `Alt+V` - Paste image; **macOS/Linux**: `Ctrl+V` - Paste image (with prompt)
- `Ctrl+L` - Clear input from cursor position to the left
- `Ctrl+R` - Clear input from cursor position to the right
- `Shift+Tab` - Toggle Yolo mode on/off
- `ESC` - Stop AI generation
- **Double-click `ESC`** - Rollback conversation (with file checkpoints)

### Token Usage

The input area displays context usage percentage, token count, cache hit tokens, and cache creation tokens.

![alt text](docs/images/image-3.png)

## Snow System Files

All Snow files are stored in the `.snow` folder in your user directory. Here's what each file/folder contains:

![alt text](docs/images/image-4.png)

- **log** - Runtime logs (not uploaded anywhere, kept locally for debugging). Safe to delete
- **profiles** - Multiple configuration files for switching between different API/model setups
- **sessions** - All conversation history (required for `/resume` and other features, not uploaded)
- **snapshots** - File snapshots before AI edits (used for rollback). Automatic management, no manual intervention needed
- **todo** - Persisted todo lists from each conversation (prevents AI from forgetting tasks if app exits unexpectedly)
- **active-profile.txt** - Identifies the currently active profile (for backward compatibility with early versions)
- **config.json** - Main API configuration file
- **custom-headers.json** - Custom request headers
- **mcp-config.json** - MCP service configuration
- **system-prompt.txt** - Custom system prompt content

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MayDay-wpf/snow-cli&type=Date)](https://star-history.com/#MayDay-wpf/snow-cli&Date)