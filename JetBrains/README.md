# Snow CLI JetBrains Plugin

JetBrains IDE plugin for integrating with Snow AI CLI. Provides intelligent code navigation and search powered by AI, with support for IntelliJ IDEA, PyCharm, WebStorm, and other JetBrains IDEs.

## Features

- **WebSocket Integration**: Real-time bi-directional communication with Snow CLI
- **Editor Context Tracking**: Automatically sends active file, cursor position, and selected text to Snow CLI
- **Code Diagnostics**: Retrieves and shares code diagnostics with the AI
- **Go to Definition**: Navigate to symbol definitions via Snow CLI
- **Find References**: Find all references to symbols across the project
- **Document Symbols**: Extract and share document structure with the AI
- **Auto-Reconnection**: Robust reconnection with exponential backoff strategy
- **Terminal Integration**: Quick access to Snow CLI from the toolbar

## Recommended Terminal for Windows Users

For the best experience on Windows, we recommend:

- **PowerShell 7+**: Modern cross-platform PowerShell with enhanced features and compatibility
  - GitHub: https://github.com/PowerShell/PowerShell
- **Windows Terminal**: Modern terminal application with tabs, panes, and GPU-accelerated rendering
  - GitHub: https://github.com/microsoft/terminal

**Installation**:

```bash
# Install via winget (built-in on Windows 10/11)
winget install Microsoft.PowerShell
winget install Microsoft.WindowsTerminal

# Or install from Microsoft Store
```
