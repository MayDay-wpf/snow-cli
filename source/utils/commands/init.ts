import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

const PROMPT_PREVIEW_MAX = 120;

function truncatePrompt(text: string): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	if (flat.length <= PROMPT_PREVIEW_MAX) return flat;
	return flat.slice(0, PROMPT_PREVIEW_MAX - 1).trimEnd() + '\u2026';
}

const INIT_WORKFLOW_PROMPT = `You are a project initialization specialist for Snow CLI. Execute the following multi-step workflow IN ORDER. Each step builds on the previous one.

CRITICAL RULES:
- Step 1 is AUTOMATIC — do NOT ask the user for confirmation.
- Steps 2, 3, and 4 MUST use the "askuser-ask_question" tool to ask the user BEFORE taking action.
- If the user declines a step, skip it gracefully and move to the next step.
- Respond in the same language the user is using. If no prior user message is available, infer from the project's primary language (README, package.json). If still unclear, use Chinese.

---

## Step 1: Generate AGENTS.md (Automatic)

Analyze the current project directory and generate or update an AGENTS.md file.

**Tasks:**
1. Use filesystem-read to explore the project root directory structure
2. Read key files: package.json, README.md, tsconfig.json, Cargo.toml, pyproject.toml, go.mod, or any configuration files present
3. Identify the project type, technologies, frameworks, and architecture
4. Examine source code structure and main modules
5. Generate or update AGENTS.md with this structure:

\`\`\`
## Project Name
Brief one-line description

## Overview
2-3 paragraph summary

## Technology Stack
- Language/Runtime
- Framework(s)
- Key Dependencies
- Build Tools
- Quality Tools

## Project Structure
directory tree with explanations

## Key Features
- Feature list

## Getting Started
### Prerequisites
### Installation
### Usage

## Development
### Available Scripts
### Development Workflow

## Configuration

## Architecture

## Contributing

## License
\`\`\`

**Instructions:**
- If AGENTS.md already exists, read it first and UPDATE rather than replace
- Use filesystem-create to save AGENTS.md in the project root
- Be thorough but concise

---

## Step 2: Recommend Project-Level Hooks

Snow CLI has a Hooks system that can automate actions on events. Available hook types:
- onUserMessage: Triggered when user sends a message
- beforeToolCall: Runs before a tool is called (supports matcher for specific tools)
- toolConfirmation: Tool secondary confirmation (includes sensitive word check)
- afterToolCall: Runs after a tool call completes (supports matcher)
- onSubAgentComplete: Runs when a sub-agent task finishes
- beforeCompress: Runs before context compression
- onSessionStart: Runs when a new session starts or an existing one is resumed
- onStop: Runs before AI flow ends

Hook actions can be:
- type "command": Execute a shell command
- type "prompt": Inject a prompt (only for onSubAgentComplete and onStop)

Hooks are stored as JSON files in \`.snow/hooks/\` directory (project-level), one file per hook type.
Example file \`.snow/hooks/afterToolCall.json\`:
\`\`\`json
{
    "afterToolCall": [
        {
            "matcher": "terminal-execute",
            "description": "Send notification after terminal commands",
            "hooks": [
                {
                    "type": "command",
                    "command": "osascript -e 'display notification \\"Task completed\\" with title \\"Snow CLI\\"'",
                    "enabled": true
                }
            ]
        }
    ]
}
\`\`\`

**Tasks:**
1. Based on the project type identified in Step 1, determine which hooks would be most useful. Consider recommending:
   - Notification hooks (afterToolCall/onSubAgentComplete) for long-running tasks
   - Code quality hooks (beforeToolCall matcher on filesystem-create/filesystem-edit) for linting reminders
   - Session start hooks (onSessionStart) for loading project context
   - Security hooks (toolConfirmation) for dangerous command warnings
2. Use "askuser-ask_question" to present recommended hooks as options. Ask the user which ones they want to install. Include a "Skip" option.
3. If the user selects hooks, create the corresponding JSON files in \`.snow/hooks/\` directory using filesystem-create.

---

## Step 3: ROLE.md Setup

Check if a ROLE.md file exists in the project root.

**Tasks:**
1. Use filesystem-read to check if ROLE.md exists in the project root
2. If ROLE.md already exists, SKIP this step entirely (inform the user it exists and move on)
3. If ROLE.md does NOT exist, use "askuser-ask_question" to ask: whether they want to create a project ROLE.md (options: "Yes, create based on project analysis" / "No, skip")
4. If user agrees, generate a ROLE.md tailored to the project based on:
   - The project's language and framework
   - Common coding conventions for that stack
   - File naming patterns observed in the project
   - Any existing .editorconfig, .eslintrc, .prettierrc rules
   - Example content might include: response language preference, code style rules, testing requirements, documentation standards
5. Save ROLE.md to the project root using filesystem-create

---

## Step 4: Recommend Skills and MCP Servers

Based on the project type and tech stack identified in Step 1, recommend relevant Skills and MCP servers.

**Tasks:**
1. Use web-search to find popular MCP servers suitable for this project's technology stack. Search for terms like:
   - "<framework/language> MCP server" (e.g. "React MCP server", "Python MCP server")
   - "Model Context Protocol servers <technology>"
   - Look for well-known MCP servers: database connectors, API integrations, documentation tools, etc.
2. Based on the project analysis, recommend Skills that would be useful (common ones):
   - For web projects: deployment skills, testing skills, accessibility audit skills
   - For backend projects: database migration skills, API documentation skills
   - For any project: code review skills, git workflow skills, documentation skills
3. Use "askuser-ask_question" to present the recommendations in a clear list. Options should include each recommended item plus "Skip all".
4. For MCP servers the user wants to install:
   - Create or update the project-level MCP config by writing to \`.snow/settings.json\`
   - The MCP config is stored under the "mcpServers" key in settings.json
   - Each MCP server entry has the structure:
     \`\`\`json
     {
       "mcpServers": {
         "server-name": {
           "command": "npx",
           "args": ["-y", "@package/mcp-server"],
           "env": {},
           "enabled": true
         }
       }
     }
     \`\`\`
   - For HTTP-based MCP servers:
     \`\`\`json
     {
       "mcpServers": {
         "server-name": {
           "type": "http",
           "url": "https://example.com/mcp",
           "enabled": true
         }
       }
     }
     \`\`\`
   - IMPORTANT: Read existing \`.snow/settings.json\` first (if it exists) and MERGE new mcpServers into existing config
5. For Skills the user wants to install:
   - Create the skill directory structure under \`.snow/skills/<skill-name>/\`
   - Each skill needs at minimum a SKILL.md file with frontmatter:
     \`\`\`markdown
     ---
     name: skill-name
     description: What this skill does
     allowed-tools:
     ---

     # Skill Name

     ## Instructions
     ...
     \`\`\`

---

## Completion

After all steps are done (or skipped), provide a brief summary of what was accomplished:
- Whether AGENTS.md was created/updated
- Which hooks were installed (if any)
- Whether ROLE.md was created
- Which MCP servers/Skills were installed (if any)

Begin the workflow now.`;

registerCommand('init', {
	execute: (args?: string): CommandResult => {
		const userNote = args?.trim();
		const prompt = userNote
			? `${INIT_WORKFLOW_PROMPT}\n\n---\n\nUser's additional instructions:\n${userNote}`
			: INIT_WORKFLOW_PROMPT;
		return {
			success: true,
			action: 'initProject',
			message: userNote ? truncatePrompt(userNote) : '',
			prompt,
		};
	},
});

export default {};
