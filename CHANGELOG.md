# Changelog

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
