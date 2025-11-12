import {registerCommand, type CommandResult} from '../commandExecutor.js';

// Init command handler - Triggers AI to analyze current project and generate SNOW.md
registerCommand('init', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'initProject',
			message: 'Starting project initialization...',
			// Pass the optimized English prompt for AI
			prompt: `You are an expert technical documentation specialist. Analyze the current project directory comprehensively and generate or update a SNOW.md file.

**Your tasks:**
1. Use ALL available MCP tools (filesystem, terminal) to thoroughly explore the project structure
2. Read key files: package.json, README.md, tsconfig.json, configuration files
3. Identify the project type, technologies, frameworks, and architecture
4. Examine the source code structure and main modules
5. Check for existing documentation files
6. Generate or update SNOW.md with the following structure:

# SNOW.md Structure

## Project Name
Brief one-line description

## Overview
2-3 paragraph summary of what this project does and its purpose

## Technology Stack
- Language/Runtime
- Framework(s)
- Key Dependencies
- Build Tools

## Project Structure
\`\`\`
directory tree with explanations
\`\`\`

## Key Features
- Feature 1
- Feature 2
- ...

## Getting Started

### Prerequisites
Required software/tools

### Installation
\`\`\`bash
step by step commands
\`\`\`

### Usage
Basic usage examples and commands

## Development

### Available Scripts
Describe npm scripts or make targets

### Development Workflow
How to develop, test, and build

## Configuration
Explain configuration files and environment variables

## Architecture
High-level architecture overview (if complex project)

## Contributing
Guidelines for contributors (if applicable)

## License
License information (check package.json or LICENSE file)

---

**Important instructions:**
- Use filesystem-read to explore directories (it automatically lists contents when path is a directory)
- Use filesystem-read to read important files
- Use terminal-execute to run commands like 'npm run' to discover available scripts
- Be thorough but concise - focus on essential information
- If SNOW.md already exists, read it first and UPDATE it rather than replace
- Format with proper Markdown syntax
- After generating content, use filesystem-create to save SNOW.md in the project root
- Confirm completion with a brief summary

Begin your analysis now. Use every tool at your disposal to understand this project completely.`,
		};
	},
});

export default {};
