import {dirname, join, relative} from 'path';
import {existsSync} from 'fs';
import {readFile} from 'fs/promises';
import {homedir} from 'os';
import matter from 'gray-matter';

export interface SkillMetadata {
	name: string;
	description: string;
	allowedTools?: string[];
}

export interface Skill {
	id: string;
	name: string;
	description: string;
	location: 'project' | 'global';
	path: string;
	content: string;
	allowedTools?: string[];
}

/**
 * Read and parse SKILL.md file
 */
async function readSkillFile(skillPath: string): Promise<{
	metadata: SkillMetadata;
	content: string;
} | null> {
	try {
		const skillFile = join(skillPath, 'SKILL.md');
		if (!existsSync(skillFile)) {
			return null;
		}

		const fileContent = await readFile(skillFile, 'utf-8');
		const parsed = matter(fileContent);

		// Remove leading description section between --- markers if exists
		let content = parsed.content.trim();
		const descriptionPattern = /^---\s*[\s\S]*?---\s*/;
		if (descriptionPattern.test(content)) {
			content = content.replace(descriptionPattern, '').trim();
		}

		// Parse allowed-tools field (comma-separated list or array)
		let allowedTools: string[] | undefined;
		const allowedToolsData = parsed.data['allowed-tools'];
		if (allowedToolsData) {
			if (Array.isArray(allowedToolsData)) {
				allowedTools = allowedToolsData.filter(
					tool => typeof tool === 'string' && tool.trim().length > 0,
				);
			} else if (
				typeof allowedToolsData === 'string' &&
				allowedToolsData.trim()
			) {
				allowedTools = allowedToolsData
					.split(',')
					.map(tool => tool.trim())
					.filter(tool => tool.length > 0);
			}
		}

		return {
			metadata: {
				name: parsed.data['name'] || '',
				description: parsed.data['description'] || '',
				allowedTools,
			},
			content,
		};
	} catch (error) {
		console.error(`Failed to read skill at ${skillPath}:`, error);
		return null;
	}
}

function normalizeSkillId(skillId: string): string {
	return skillId.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

async function loadSkillsFromDirectory(
	skills: Map<string, Skill>,
	baseSkillsDir: string,
	location: Skill['location'],
): Promise<void> {
	if (!existsSync(baseSkillsDir)) {
		return;
	}

	try {
		const {readdirSync} = await import('fs');
		const pendingDirs: string[] = [baseSkillsDir];

		while (pendingDirs.length > 0) {
			const currentDir = pendingDirs.pop();
			if (!currentDir) continue;

			let entries: Array<import('fs').Dirent>;
			try {
				entries = readdirSync(currentDir, {withFileTypes: true});
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (entry.isDirectory()) {
					pendingDirs.push(join(currentDir, entry.name));
					continue;
				}

				if (!entry.isFile() || entry.name !== 'SKILL.md') {
					continue;
				}

				const skillFile = join(currentDir, entry.name);
				const skillDir = dirname(skillFile);
				const rawSkillId = relative(baseSkillsDir, skillDir);
				const skillId = normalizeSkillId(rawSkillId);

				if (!skillId || skillId === '.') {
					continue;
				}

				const skillData = await readSkillFile(skillDir);
				if (!skillData) {
					continue;
				}

				const fallbackName =
					skillId.split('/').filter(Boolean).pop() || skillId;

				skills.set(skillId, {
					id: skillId,
					name: skillData.metadata.name || fallbackName,
					description: skillData.metadata.description || '',
					location,
					path: skillDir,
					content: skillData.content,
					allowedTools: skillData.metadata.allowedTools,
				});
			}
		}
	} catch (error) {
		console.error(`Failed to load ${location} skills:`, error);
	}
}

/**
 * Scan and load all available skills
 * Project skills have priority over global skills
 */
async function loadAvailableSkills(
	projectRoot?: string,
): Promise<Map<string, Skill>> {
	const skills = new Map<string, Skill>();
	const globalSkillsDir = join(homedir(), '.snow', 'skills');
	const projectSkillsDir = projectRoot
		? join(projectRoot, '.snow', 'skills')
		: null;

	// Load global skills first, then project skills override global skills
	await loadSkillsFromDirectory(skills, globalSkillsDir, 'global');
	if (projectSkillsDir) {
		await loadSkillsFromDirectory(skills, projectSkillsDir, 'project');
	}

	return skills;
}

/**
 * Generate dynamic skill tool description
 */
function generateSkillToolDescription(skills: Map<string, Skill>): string {
	const skillsList = Array.from(skills.values())
		.map(
			skill => `<skill>
<name>
${skill.id}
</name>
<description>
${skill.description}
</description>
<location>
${skill.location}
</location>
</skill>`,
		)
		.join('\n');

	return `Execute a skill within the main conversation

<skills_instructions>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke skills using this tool with the skill id only (no arguments)
- When you invoke a skill, you will see <command-message>The "{name}" skill is loading</command-message>
- The skill's prompt will expand and provide detailed instructions on how to complete the task
- Examples:
  - skill: "pdf" - invoke the pdf skill
  - skill: "data-analysis" - invoke the data-analysis skill

Important:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
</skills_instructions>

<available_skills>
${skillsList}
</available_skills>`;
}

/**
 * Get MCP tools for skills (dynamic generation based on available skills)
 */
export async function getMCPTools(projectRoot?: string) {
	const skills = await loadAvailableSkills(projectRoot);

	// If no skills available, return empty array
	if (skills.size === 0) {
		return [];
	}

	const description = generateSkillToolDescription(skills);

	return [
		{
			name: 'skill-execute',
			description,
			inputSchema: {
				type: 'object',
				properties: {
					skill: {
						type: 'string',
						description:
							'The skill id (no arguments). E.g., "pdf", "data-analysis", or "helloagents/analyze"',
					},
				},
				required: ['skill'],
				additionalProperties: false,
				$schema: 'http://json-schema.org/draft-07/schema#',
			},
		},
	];
}

/**
 * Generate directory tree structure for skill
 */
async function generateSkillTree(skillPath: string): Promise<string> {
	try {
		const {readdirSync} = await import('fs');
		const entries = readdirSync(skillPath, {withFileTypes: true});

		const lines: string[] = [];
		const sortedEntries = entries.sort((a, b) => {
			// Directories first, then files
			if (a.isDirectory() && !b.isDirectory()) return -1;
			if (!a.isDirectory() && b.isDirectory()) return 1;
			return a.name.localeCompare(b.name);
		});

		for (let i = 0; i < sortedEntries.length; i++) {
			const entry = sortedEntries[i];
			if (!entry) continue;

			const isLast = i === sortedEntries.length - 1;
			const prefix = isLast ? '└─' : '├─';
			const connector = isLast ? '   ' : '│  ';

			if (entry.isDirectory()) {
				lines.push(`${prefix} ${entry.name}/`);
				// Recursively list directory contents (one level deep only)
				try {
					const subPath = join(skillPath, entry.name);
					const subEntries = readdirSync(subPath, {withFileTypes: true});
					const sortedSubEntries = subEntries.sort((a, b) =>
						a.name.localeCompare(b.name),
					);

					for (let j = 0; j < sortedSubEntries.length; j++) {
						const subEntry = sortedSubEntries[j];
						if (!subEntry) continue;

						const subIsLast = j === sortedSubEntries.length - 1;
						const subPrefix = subIsLast ? '└─' : '├─';
						const fileType = subEntry.isDirectory() ? '[DIR]' : '[FILE]';
						lines.push(
							`${connector}  ${subPrefix} ${fileType} ${subEntry.name}`,
						);
					}
				} catch {
					// Ignore subdirectory read errors
				}
			} else {
				const fileType = entry.name === 'SKILL.md' ? '[MAIN]' : '[FILE]';
				lines.push(`${prefix} ${fileType} ${entry.name}`);
			}
		}

		return lines.join('\n');
	} catch (error) {
		return '(Unable to generate directory tree)';
	}
}

/**
 * Execute skill tool
 */
export async function executeSkillTool(
	toolName: string,
	args: any,
	projectRoot?: string,
): Promise<string> {
	if (toolName !== 'skill-execute') {
		throw new Error(`Unknown tool: ${toolName}`);
	}

	const requestedSkillId = args.skill;
	if (!requestedSkillId || typeof requestedSkillId !== 'string') {
		throw new Error('skill parameter is required and must be a string');
	}

	const skillId = normalizeSkillId(requestedSkillId);

	// Load available skills
	const skills = await loadAvailableSkills(projectRoot);
	const skill = skills.get(skillId);

	if (!skill) {
		const availableSkills = Array.from(skills.keys()).join(', ');
		throw new Error(
			`Skill \"${skillId}\" not found. Available skills: ${
				availableSkills || 'none'
			}`,
		);
	}

	// Generate directory tree for skill
	const directoryTree = await generateSkillTree(skill.path);

	// Generate allowed tools restriction if specified
	let toolRestriction = '';
	if (skill.allowedTools && skill.allowedTools.length > 0) {
		toolRestriction = `

<tool-restrictions>
CRITICAL: This skill ONLY allows the following tools:
${skill.allowedTools.map(tool => `- ${tool}`).join('\n')}

You MUST NOT use any other tools. Any tool not listed above is forbidden for this skill.
</tool-restrictions>`;
	}

	// Return the skill content (markdown instructions)
	return `<command-message>The "${skill.name}" skill is loading</command-message>

${skill.content}${toolRestriction}

<skill-info>
Skill Name: ${skill.name}
Absolute Path: ${skill.path}

Directory Structure:
\`\`\`
${skill.name}/
${directoryTree}
\`\`\`

Note: You can use filesystem-read tool to read any file in this skill directory using the absolute path above.
</skill-info>`;
}

export const mcpTools = [];
