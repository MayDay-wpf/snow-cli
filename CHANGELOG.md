# Changelog

## v0.4.34

- Add Anthropic cache TL configuration options

## v0.4.33

- Update dependencies and optimize table rendering

## v0.4.32

- Urgently fix the issue of TODO tool response loss after rejection in non-YOLO mode, as well as the issue of markdown table not being fully displayed.

## v0.4.31

- feat(pdf): Add support for PDF.js Worker files

- feat(cli): Implement sensitive command detection and confirmation mechanism

- feat(api): Support sub-agent configuration and custom system prompts

- feat(task): Implement background task management function

- feat(codebase): Enhance error handling for file listeners and code formatting

- feat(chat): Add functionality to restore the last session

- fix(MarkdownRenderer): Prevent rendering issues caused by empty lines

- docs(readme): Change SNOW.md to AGENTS.md to match the new project documentation standards

## v0.4.30

- feat(API): Updated the system prompt template to strengthen the file path validity requirements

- Added principle 7: requires all file system tool calls to use the exact file path,
  Undefined, empty strings, or placeholder paths are prohibited.
- refactor(input): Optimizes the keyboard input processing logic to support the separation ofmulti-line input and command submission
- Modify the behavior of the enter key: Ctrl+Enter inserts a line break, and Enter to submitthe message separately;
  When a slash is added to a non-whitespace character in front of the cursor, a line break isautomatically inserted to avoid missubmission.
- FEAT (MCP): Enhanced file system tool parameter checksum description
- filesystem-read/create/edit/edit_search tool adds checks to filePath and other keyparameters
- Streamlined and clarified the requirements for paths in the description of each tool,emphasizing the need to use precise paths
- Unified error message format and AI usage suggestions
- fix(ui): Fixed potential security issues with the Markdown renderer and ANSI escapeexceptions
- Added render result type checking to prevent crashes caused by invalid content
- Fixed an issue where markdown-it-terminal incorrectly removed "undefined" in theindentation list

- Fixed a bug where the "Always approve this tool" option did not take effect in non-YOLOmode of the sub-agent

## v0.4.29

- Make sharp an optional dependency and optimize the SVG conversion logic

## v0.4.28

- FileList .gitignore

## v0.4.27

- MCP long connection, controllable start and stop, join Hooks, TODO optimization, SVG recognition compatibility

## v0.4.26

- Introduce chokidar to improve file monitoring performance and reliability, add --yolo and --c-yolo commands, and add custom commands

## v0.4.25

- Updated the multilingual copy to explain that connection failures do not affect usage

## 0.4.24

- Fix MCP configuration errors and fix uncaught exceptions when using in non-IDE environments

## v0.4.23

- Improve navigation and status management of custom request header interface

## v0.4.22

- Silently handle VS Code connection failures and update status indicators
- Adjust maxContextTokens in the default configuration from 4000 to 120000, and adjust maxTokenfrom 4096 to 32000 to adapt to larger model context and output requirements.

## v0.4.21

- fix(utils): Optimize placeholder processing logic in text buffer

## v0.4.20

- Improve the file monitoring event handling logic

## v0.4.19

- Custom theme, fix some display bugs

## v0.4.17

- Add and copy the tiktoken_bg.wasm file to the bundle directory

## v0.4.16

- Implement component lazy loading and IDE connection optimization

## v0.4.15

- Check whether the command has been loaded before automatically connecting to VS Code

## v0.4.12

- Codex XHIGH

## v0.4.11

- Lazy loading import

## v0.4.10

- Optimize startup speed and initialization exceptions

## v0.4.9

- Update dependency package mirror source
- Add multiple theme options
- Optimize dependency download speed and stability

## v0.4.8

- Update some outdated dependencies

## v0.4.7

- Support for multi-modal file reading (images and Office documents)
- Added automatic detection and base64 encoding support for image files (PNG, JPG,GIF, etc.)
- Added parsing and text extraction functions for Office documents (PDF, Word, Excel,PPT)

## v0.4.5

- Markdown rendering part change library

## v0.4.4

- Add disconnection retry

## v0.4.0

- Added New Agent(Prompt optimization)
- fix some bugs
- Supports turning off automatic compression
- Optimize file search and run performance

## v0.3.37

- Added complete Spanish and more translation file with all UI texts
- Updated command panel to use localized commanddescriptions
- Localized global exit notification message
- Enhanced help panel with translated keyboardshortcuts
- Added translations for chat screen elements andhints
- Fixed localization integration in variouscomponents

## v0.3.36

- Improve batch operations in filesystem tools and enhance keyboard input handling for better paste management

## v0.3.35

- Enhance text input handling with improved paste detection and rendering

## v0.3.34

- Make API key optional for local deployments in embedding functions and update validation messages

## v0.3.33

- Added SystemPromptConfigScreen for managing system prompts,including add, edit, activate, and delete functionalities.
- Integrated system prompt management into the WelcomeScreen foreasy access.
- Migrated system prompt storage from a text file to a structuredJSON format for better management.
- Introduced CustomHeadersScreen for managing custom request headerswith similar functionalities.
- Enhanced apiConfig utility to support new system prompt and customheaders configurations.
- Improved error handling and user feedback in the UI.
- Ensured backward compatibility with existing system prompt data.

## v0.3.32

- Add support for CodeBase

## v0.3.31

- Add notebook management features for updating, deleting, and listing notes; enhance sub-agent execution handling

## v0.3.30

- Update system prompt guidelines and improve VSCode connection handling

## v0.3.29

Enhance language configuration and symbol patterns

- Updated TypeScript and JavaScript symbol patterns to support additional syntax and constructs.
- Added support for new file extensions in TypeScript and JavaScript configurations.
- Enhanced Python, Go, Rust, Java, C#, and other language configurations to improve symbol detection.
- Introduced role management in SubAgent configuration, allowing for optional role assignment.
- Modified session conversion logic to handle tool calls more effectively.
- Improved VSCode connection management with timeout handling and cleanup procedures.

### Installation

```bash
$ npm install --global snow-ai
```

### Update

```bash
$ snow --update
```

### Usage

```bash
snow
```
