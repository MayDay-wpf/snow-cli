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

## Architecture

The plugin consists of several key components:

### 1. SnowWebSocketManager
Manages WebSocket connection to Snow CLI server (localhost:9527):
- Auto-connect on startup
- Exponential backoff reconnection (max 10 attempts)
- Context caching for seamless reconnection
- Thread-safe message sending

### 2. SnowEditorContextTracker
Tracks and sends editor state to Snow CLI:
- Active file path
- Workspace folder
- Cursor position (line, column)
- Selected text
- Listens to file switches and selection changes

### 3. SnowMessageHandler
Processes incoming WebSocket messages:
- `getDiagnostics`: Returns code diagnostics for a file
- `aceGoToDefinition`: Provides definition locations
- `aceFindReferences`: Returns all references to a symbol
- `aceGetSymbols`: Extracts document symbols

### 4. SnowCodeNavigator
Implements code navigation features using IntelliJ Platform APIs:
- PSI-based symbol resolution
- Reference search integration
- Symbol hierarchy extraction

### 5. SnowPluginLifecycle
Manages plugin lifecycle:
- Initializes WebSocket connection on IDE startup
- Sets up project-specific trackers and handlers
- Cleans up resources on shutdown

## Installation

### From Source

1. **Prerequisites**:
   - JDK 17 or higher
   - Gradle 8.4+ (included via wrapper)
   - JetBrains IDE (2023.1.5 or newer)

2. **Build the plugin**:
   ```bash
   cd JetBrains
   ./gradlew buildPlugin
   ```

3. **Install in IDE**:
   - Open your JetBrains IDE
   - Go to **Settings/Preferences** → **Plugins**
   - Click the gear icon ⚙️ → **Install Plugin from Disk...**
   - Navigate to `JetBrains/build/distributions/snow-cli-jetbrains-0.3.1.zip`
   - Click **OK** and restart the IDE

### From Marketplace (Future)
The plugin will be available on the JetBrains Marketplace once published.

## Usage

### Starting Snow CLI

1. **From Toolbar**: Click the Snow CLI icon in the main toolbar
2. **From Menu**: Go to **Tools** → **Open Snow CLI**
3. **Manual**: Open a terminal and run `snow`

The plugin will automatically connect to the Snow CLI WebSocket server once it's running.

### How It Works

1. **Launch Snow CLI**: The plugin opens an integrated terminal and starts Snow CLI
2. **Auto-Connect**: WebSocket connection is established to `ws://localhost:9527`
3. **Context Sync**: Your current editor state is sent to Snow CLI
4. **AI Assistance**: Snow CLI uses the context for intelligent responses
5. **Code Navigation**: The AI can request definitions, references, and symbols

### Supported IDEs

- IntelliJ IDEA (Community & Ultimate)
- PyCharm (Community & Professional)
- WebStorm
- PhpStorm
- GoLand
- RubyMine
- CLion
- DataGrip
- Rider
- Android Studio

## Development

### Project Structure

```
JetBrains/
├── build.gradle.kts              # Gradle build configuration
├── settings.gradle.kts            # Gradle settings
├── gradle.properties              # Plugin metadata
├── src/
│   └── main/
│       ├── kotlin/com/snow/plugin/
│       │   ├── SnowWebSocketManager.kt       # WebSocket connection
│       │   ├── SnowEditorContextTracker.kt   # Editor tracking
│       │   ├── SnowMessageHandler.kt         # Message processing
│       │   ├── SnowCodeNavigator.kt          # Code navigation
│       │   ├── SnowPluginLifecycle.kt        # Lifecycle management
│       │   └── actions/
│       │       └── OpenSnowTerminalAction.kt # Toolbar action
│       └── resources/
│           ├── META-INF/
│           │   └── plugin.xml                # Plugin descriptor
│           └── icons/
│               └── snow.png                  # Plugin icon
└── README.md
```

### Building

```bash
# Compile and build plugin
./gradlew buildPlugin

# Run IDE with plugin for testing
./gradlew runIde

# Run tests
./gradlew test

# Verify plugin compatibility
./gradlew verifyPlugin
```

### WebSocket Protocol

The plugin communicates with Snow CLI using JSON messages:

#### Context Updates (Plugin → Snow CLI)
```json
{
  "type": "context",
  "workspaceFolder": "/path/to/project",
  "activeFile": "/path/to/file.kt",
  "cursorPosition": {
    "line": 42,
    "character": 15
  },
  "selectedText": "optional selected text"
}
```

#### Diagnostics Request (Snow CLI → Plugin)
```json
{
  "type": "getDiagnostics",
  "filePath": "/path/to/file.kt",
  "requestId": "unique-id"
}
```

#### Diagnostics Response (Plugin → Snow CLI)
```json
{
  "type": "diagnostics",
  "requestId": "unique-id",
  "diagnostics": [
    {
      "message": "Unused variable",
      "severity": "warning",
      "line": 10,
      "character": 5,
      "source": "kotlin"
    }
  ]
}
```

#### Go to Definition Request (Snow CLI → Plugin)
```json
{
  "type": "aceGoToDefinition",
  "filePath": "/path/to/file.kt",
  "line": 42,
  "column": 15,
  "requestId": "unique-id"
}
```

#### Go to Definition Response (Plugin → Snow CLI)
```json
{
  "type": "aceGoToDefinitionResult",
  "requestId": "unique-id",
  "definitions": [
    {
      "filePath": "/path/to/definition.kt",
      "line": 10,
      "column": 5,
      "endLine": 10,
      "endColumn": 20
    }
  ]
}
```

## Configuration

The plugin uses default settings:
- **WebSocket URL**: `ws://localhost:9527`
- **Max Reconnect Attempts**: 10
- **Base Reconnect Delay**: 2 seconds
- **Max Reconnect Delay**: 30 seconds

These can be customized by modifying the constants in `SnowWebSocketManager.kt`.

## Troubleshooting

### Plugin doesn't connect to Snow CLI
1. Ensure Snow CLI is running (`snow` command in terminal)
2. Check that port 9527 is not blocked by firewall
3. Restart the IDE and try again
4. Check IDE logs: **Help** → **Show Log in Finder/Explorer**

### Context not updating
1. Verify WebSocket connection is active (check logs)
2. Try switching files to trigger context update
3. Restart Snow CLI with `/clear` command

### Build errors
1. Ensure JDK 17+ is installed
2. Run `./gradlew clean` before building
3. Check Gradle version: `./gradlew --version`

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

Same as Snow CLI project.

## Related Projects

- [Snow CLI](https://github.com/yourusername/snow-cli) - The main CLI tool
- [VSCode Extension](../VSIX/) - VSCode integration

## Support

For issues and questions:
- GitHub Issues: [Report a bug](https://github.com/yourusername/snow-cli/issues)
- Documentation: [Snow CLI Docs](https://github.com/yourusername/snow-cli/blob/main/README.md)

## Acknowledgments

Built with:
- [IntelliJ Platform SDK](https://plugins.jetbrains.com/docs/intellij/)
- [Java-WebSocket](https://github.com/TooTallNate/Java-WebSocket)
- [Kotlin](https://kotlinlang.org/)
