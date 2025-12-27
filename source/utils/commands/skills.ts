import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {homedir} from 'os';
import {join} from 'path';
import {mkdir, writeFile} from 'fs/promises';
import {existsSync} from 'fs';
import {getOpenAiConfig} from '../config/apiConfig.js';
import {
	createStreamingChatCompletion,
	type ChatMessage,
} from '../../api/chat.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {parseJsonWithFix} from '../core/retryUtils.js';

// Skill template metadata
export interface SkillMetadata {
	name: string;
	description: string;
}

export interface GeneratedSkillContent {
	skillMarkdownBody: string;
	referenceMarkdown: string;
	examplesMarkdown: string;
}

export interface GeneratedSkillDraft {
	skillName: string;
	description: string;
	generated: GeneratedSkillContent;
}

// Skill location type
export type SkillLocation = 'global' | 'project';

// Validate skill id (supports optional /namespace segments)
export function validateSkillId(name: string): {
	valid: boolean;
	error?: string;
} {
	if (!name || name.trim().length === 0) {
		return {valid: false, error: 'Skill name cannot be empty'};
	}

	const trimmedName = name.trim();

	// Keep legacy per-segment limit (64), but allow namespaced IDs to be longer overall.
	if (trimmedName.length > 256) {
		return {valid: false, error: 'Skill name must be 256 characters or less'};
	}

	if (trimmedName.includes('\\')) {
		return {
			valid: false,
			error:
				'Skill name must use "/" as namespace separator (backslashes are not allowed)',
		};
	}

	if (trimmedName.includes(':')) {
		return {valid: false, error: 'Skill name must not contain ":"'};
	}

	if (trimmedName.startsWith('/') || trimmedName.endsWith('/')) {
		return {valid: false, error: 'Skill name must not start or end with "/"'};
	}

	const segments = trimmedName.split('/');
	if (segments.some(segment => segment.length === 0)) {
		return {
			valid: false,
			error: 'Skill name must not contain empty namespace segments',
		};
	}

	const validSegmentPattern = /^[a-z0-9-]+$/;
	for (const segment of segments) {
		if (segment === '.' || segment === '..') {
			return {
				valid: false,
				error: 'Skill name must not contain "." or ".." segments',
			};
		}

		if (segment.length > 64) {
			return {
				valid: false,
				error: 'Each skill name segment must be 64 characters or less',
			};
		}

		if (!validSegmentPattern.test(segment)) {
			return {
				valid: false,
				error:
					'Skill name segments must contain only lowercase letters, numbers, and hyphens',
			};
		}
	}

	return {valid: true};
}

// Backward compatible alias (historical name)
export function validateSkillName(name: string): {
	valid: boolean;
	error?: string;
} {
	return validateSkillId(name);
}

function stripLeadingFrontMatter(markdown: string): string {
	const content = markdown.trim();
	const descriptionPattern = /^---\s*[\s\S]*?---\s*/;
	if (descriptionPattern.test(content)) {
		return content.replace(descriptionPattern, '').trim();
	}
	return content;
}

function sanitizeSkillName(input: string): string {
	const raw = input.trim().toLowerCase();
	const replaced = raw.replace(/[\s_]+/g, '-');
	const filtered = replaced.replace(/[^a-z0-9-]/g, '');
	const collapsed = filtered.replace(/-+/g, '-').replace(/^-|-$/g, '');
	return collapsed.slice(0, 64);
}

function makeUniqueSkillName(baseName: string, projectRoot?: string): string {
	const validation = validateSkillName(baseName);
	let safeBase = validation.valid ? baseName : sanitizeSkillName(baseName);
	if (!safeBase) {
		safeBase = 'generated-skill';
	}

	let candidate = safeBase;
	let suffix = 2;

	while (
		checkSkillExists(candidate, 'global') ||
		checkSkillExists(candidate, 'project', projectRoot)
	) {
		const suffixText = `-${suffix++}`;
		const maxBaseLen = 64 - suffixText.length;
		const truncatedBase = safeBase.slice(0, Math.max(1, maxBaseLen));
		candidate = `${truncatedBase}${suffixText}`;
	}

	return candidate;
}

function extractTaggedJson(text: string): string | null {
	const match = text.match(/<json>\s*([\s\S]*?)\s*<\/json>/i);
	if (match && match[1]) {
		return match[1].trim();
	}
	return null;
}

function extractTaggedFiles(text: string): Map<string, string> {
	const map = new Map<string, string>();
	const re = /<file\s+path="([^"]+)">\s*([\s\S]*?)\s*<\/file>/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text))) {
		const path = match[1]?.trim();
		const content = match[2] ?? '';
		if (path) {
			map.set(path, content);
		}
	}
	return map;
}

function buildSkillGenerationSystemPrompt(): string {
	return `You create Snow CLI Skills (Claude Code compatible).\n\nRules (MUST FOLLOW):\n1) Output MUST ONLY contain: <json>...</json> and <file path=\"...\">...</file> blocks. No other text.\n2) The <json> block MUST be valid JSON with keys: name, description.\n3) name MUST be a directory-safe slug: lowercase letters, numbers, hyphens only (^[a-z0-9-]+$), max 64 chars.\n4) description and ALL file contents MUST be written in the SAME LANGUAGE as the user's requirement.\n5) Generate exactly 3 file blocks with these paths (case-sensitive):\n   - SKILL.md\n   - reference.md\n   - examples.md\n6) The SKILL.md content MUST NOT include YAML front matter. Start with a single H1 title and include these sections:\n   - ## Instructions\n     - ### Context\n     - ### Steps (numbered)\n   - ## Examples (at least 2)\n   - ## Best Practices\n   - ## Common Pitfalls\n   - ## Related Skills\n   - ## References\n7) Do NOT mention or include allowed-tools (Snow CLI will manage it).\n\nQuality bar:\n- Be concrete, step-by-step, with realistic examples.\n- Keep it helpful and production-oriented.`;
}

function buildSkillGenerationUserPrompt(requirement: string): string {
	return `Generate a Snow CLI Skill from the requirement below.

CRITICAL OUTPUT FORMAT (no extra text):
<json>
{"name":"example-skill","description":"..."}
</json>
<file path="SKILL.md">
# ...
</file>
<file path="reference.md">
# ...
</file>
<file path="examples.md">
# ...
</file>

Rules:
- Output ONLY the <json> and <file> blocks.
- <json> must be valid JSON with keys: name, description (no other keys).
- name must be a slug: lowercase letters, numbers, hyphens only (^[a-z0-9-]+$), max 64 chars.
- description and ALL file contents MUST be written in the SAME LANGUAGE as the requirement.
- The SKILL.md content MUST NOT include YAML front matter.
- Do NOT mention allowed-tools.

Requirement:
${requirement}`;
}

async function callModelForText(
	messages: ChatMessage[],
	abortSignal?: AbortSignal,
): Promise<string> {
	const config = getOpenAiConfig();
	const model = config.advancedModel || config.basicModel;
	if (!model) {
		throw new Error('未配置模型，请先在设置中选择模型');
	}

	let stream:
		| AsyncGenerator<any, void, unknown>
		| AsyncGenerator<{type?: string; content?: string}, void, unknown>;

	switch (config.requestMethod) {
		case 'anthropic':
			stream = createStreamingAnthropicCompletion(
				{
					model,
					messages,
					max_tokens: 3000,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
				},
				abortSignal,
			);
			break;
		case 'gemini':
			stream = createStreamingGeminiCompletion(
				{
					model,
					messages,
					includeBuiltinSystemPrompt: false,
				},
				abortSignal,
			);
			break;
		case 'responses':
			stream = createStreamingResponse(
				{
					model,
					messages,
					includeBuiltinSystemPrompt: false,
					tool_choice: 'none',
				},
				abortSignal,
			);
			break;
		case 'chat':
		default:
			stream = createStreamingChatCompletion(
				{
					model,
					messages,
					includeBuiltinSystemPrompt: false,
					// NOTE: chat.ts uses `options.temperature || 0.7`, so 0 would be ignored.
					temperature: 0.0001,
				},
				abortSignal,
			);
			break;
	}

	let text = '';
	for await (const chunk of stream) {
		if (abortSignal?.aborted) {
			throw new Error('Request aborted');
		}

		if (chunk && typeof chunk === 'object') {
			if (chunk.type === 'content' && typeof chunk.content === 'string') {
				text += chunk.content;
				continue;
			}

			// Backward compatibility: some callers expect raw OpenAI delta chunks
			const maybeChoices = (chunk as any).choices;
			const deltaContent = maybeChoices?.[0]?.delta?.content;
			if (typeof deltaContent === 'string') {
				text += deltaContent;
			}
		}
	}

	if (!text.trim()) {
		throw new Error('模型未返回可用内容');
	}

	return text;
}

export async function generateSkillDraftWithAI(
	requirement: string,
	projectRoot?: string,
	abortSignal?: AbortSignal,
): Promise<GeneratedSkillDraft> {
	const trimmed = requirement.trim();
	if (!trimmed) {
		throw new Error('技能需求不能为空');
	}

	const systemPrompt = buildSkillGenerationSystemPrompt();
	const userPrompt = buildSkillGenerationUserPrompt(trimmed);

	const messages: ChatMessage[] = [
		{role: 'system', content: systemPrompt},
		{role: 'user', content: userPrompt},
	];

	const raw = await callModelForText(messages, abortSignal);
	const jsonText = extractTaggedJson(raw);
	const files = extractTaggedFiles(raw);

	if (!jsonText) {
		throw new Error('AI 输出缺少 <json> 块');
	}

	const parseResult = parseJsonWithFix<any>(jsonText, {
		toolName: 'skills ai json',
		logWarning: true,
		logError: true,
	});

	if (!parseResult.success || !parseResult.data) {
		throw new Error('AI 输出 JSON 解析失败');
	}

	const nameRaw =
		typeof parseResult.data.name === 'string'
			? parseResult.data.name.trim()
			: '';
	const descriptionRaw =
		typeof parseResult.data.description === 'string'
			? parseResult.data.description.trim()
			: '';

	const skillBody = files.get('SKILL.md');
	const referenceMd = files.get('reference.md');
	const examplesMd = files.get('examples.md');

	if (!skillBody || !referenceMd || !examplesMd) {
		throw new Error(
			'AI 输出缺少文件内容（需要 SKILL.md/reference.md/examples.md）',
		);
	}

	const uniqueName = makeUniqueSkillName(nameRaw, projectRoot);

	return {
		skillName: uniqueName,
		description: descriptionRaw || uniqueName,
		generated: {
			skillMarkdownBody: stripLeadingFrontMatter(skillBody),
			referenceMarkdown: stripLeadingFrontMatter(referenceMd),
			examplesMarkdown: stripLeadingFrontMatter(examplesMd),
		},
	};
}

function generateSkillMarkdownWithFrontMatter(
	metadata: SkillMetadata,
	bodyMarkdown: string,
): string {
	const cleanedBody = stripLeadingFrontMatter(bodyMarkdown).trim();
	return `---
name: ${metadata.name}
description: ${metadata.description}
allowed-tools:
---

${cleanedBody}
`;
}

// Check if skill name already exists in specified location
export function checkSkillExists(
	skillName: string,
	location: SkillLocation,
	projectRoot?: string,
): boolean {
	const skillDir = getSkillDirectory(skillName, location, projectRoot);
	return existsSync(skillDir);
}

// Get skill directory path
export function getSkillDirectory(
	skillName: string,
	location: SkillLocation,
	projectRoot?: string,
): string {
	const segments = skillName.split('/').filter(Boolean);

	if (location === 'global') {
		return join(homedir(), '.snow', 'skills', ...segments);
	}

	const root = projectRoot || process.cwd();
	return join(root, '.snow', 'skills', ...segments);
}

// Generate SKILL.md content
export function generateSkillTemplate(metadata: SkillMetadata): string {
	return `---
name: ${metadata.name}
description: ${metadata.description}
allowed-tools:
---

# ${metadata.name
		.split('-')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')}

## Instructions
Provide clear, step-by-step guidance for Claude.

### Context
Explain when and why to use this Skill.

### Steps
1. First step with detailed explanation
2. Second step with examples
3. ...

## Examples
Show concrete examples of using this Skill.

### Example 1: Basic Usage
\`\`\`
# Example command or code snippet
\`\`\`

**Expected output:**
\`\`\`
# What the result should look like
\`\`\`

### Example 2: Advanced Usage
\`\`\`
# More complex example
\`\`\`

## Best Practices
- Practice 1
- Practice 2
- Practice 3

## Common Pitfalls
- Pitfall 1: Explanation and how to avoid
- Pitfall 2: Explanation and how to avoid

## Related Skills
- skill-name-1: Brief description of relationship
- skill-name-2: Brief description of relationship

## References
For additional information, see:
- [External documentation](https://example.com)
- [reference.md](reference.md) (if you create one)
`;
}

// Generate reference.md template
export function generateReferenceTemplate(): string {
	return `# Reference Documentation

## Detailed Information

### Technical Details
Provide in-depth technical information that might be too detailed for SKILL.md.

### API Reference
If applicable, document APIs, parameters, return values, etc.

### Configuration Options
Document all available configuration options with examples.

### Troubleshooting
Common issues and their solutions.

## Additional Resources
- Links to relevant documentation
- Related tools and utilities
- Community resources
`;
}

// Generate examples.md template
export function generateExamplesTemplate(): string {
	return `# Examples

## Basic Examples

### Example 1: Title
\`\`\`
# Code or command
\`\`\`

**Explanation:**
What this example demonstrates.

### Example 2: Title
\`\`\`
# Code or command
\`\`\`

**Explanation:**
What this example demonstrates.

## Advanced Examples

### Example 3: Title
\`\`\`
# More complex code or command
\`\`\`

**Explanation:**
What this advanced example demonstrates.

## Real-World Use Cases

### Use Case 1: Title
**Scenario:** Describe the real-world scenario

**Solution:**
\`\`\`
# Implementation
\`\`\`

**Result:** What was achieved
`;
}

export async function createSkillFromGenerated(
	skillName: string,
	description: string,
	generated: GeneratedSkillContent,
	location: SkillLocation,
	projectRoot?: string,
): Promise<{success: boolean; path: string; error?: string}> {
	try {
		const skillDir = getSkillDirectory(skillName, location, projectRoot);

		// Check if skill already exists
		if (existsSync(skillDir)) {
			return {
				success: false,
				path: skillDir,
				error: `Skill "${skillName}" already exists at ${skillDir}`,
			};
		}

		// Create skill directory structure
		await mkdir(skillDir, {recursive: true});
		await mkdir(join(skillDir, 'scripts'), {recursive: true});
		await mkdir(join(skillDir, 'templates'), {recursive: true});

		const leafName = skillName.split('/').filter(Boolean).pop() || skillName;

		// Generate and write SKILL.md (front matter managed by Snow)
		const skillContent = generateSkillMarkdownWithFrontMatter(
			{name: leafName, description},
			generated.skillMarkdownBody,
		);
		await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');

		await writeFile(
			join(skillDir, 'reference.md'),
			generated.referenceMarkdown.trim() + '\n',
			'utf-8',
		);
		await writeFile(
			join(skillDir, 'examples.md'),
			generated.examplesMarkdown.trim() + '\n',
			'utf-8',
		);

		// Keep the same extra files as manual template
		const templateContent = `This is a template file for ${skillName}.

You can use this as a starting point for generating code, configurations, or documentation.

Variables can be referenced like: {{variable_name}}
`;
		await writeFile(
			join(skillDir, 'templates', 'template.txt'),
			templateContent,
			'utf-8',
		);

		const scriptContent = `#!/usr/bin/env python3
"""
Helper script for ${skillName}

Usage:
    python scripts/helper.py <input_file>
"""

import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python helper.py <input_file>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    print(f"Processing {input_file}...")
    
    # Add your processing logic here
    
    print("Done!")

if __name__ == "__main__":
    main()
`;
		await writeFile(
			join(skillDir, 'scripts', 'helper.py'),
			scriptContent,
			'utf-8',
		);

		return {
			success: true,
			path: skillDir,
		};
	} catch (error) {
		return {
			success: false,
			path: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

// Create skill template files
export async function createSkillTemplate(
	skillName: string,
	description: string,
	location: SkillLocation,
	projectRoot?: string,
): Promise<{success: boolean; path: string; error?: string}> {
	try {
		const skillDir = getSkillDirectory(skillName, location, projectRoot);

		// Check if skill already exists
		if (existsSync(skillDir)) {
			return {
				success: false,
				path: skillDir,
				error: `Skill "${skillName}" already exists at ${skillDir}`,
			};
		}

		// Create skill directory structure
		await mkdir(skillDir, {recursive: true});
		await mkdir(join(skillDir, 'scripts'), {recursive: true});
		await mkdir(join(skillDir, 'templates'), {recursive: true});

		const leafName = skillName.split('/').filter(Boolean).pop() || skillName;

		// Generate and write SKILL.md
		// OpenCode-style: frontmatter `name` uses leaf folder name (not the full namespaced id)
		const skillContent = generateSkillTemplate({name: leafName, description});
		await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');

		// Generate and write reference.md
		const referenceContent = generateReferenceTemplate();
		await writeFile(join(skillDir, 'reference.md'), referenceContent, 'utf-8');

		// Generate and write examples.md
		const examplesContent = generateExamplesTemplate();
		await writeFile(join(skillDir, 'examples.md'), examplesContent, 'utf-8');

		// Create example template file
		const templateContent = `This is a template file for ${skillName}.

You can use this as a starting point for generating code, configurations, or documentation.

Variables can be referenced like: {{variable_name}}
`;
		await writeFile(
			join(skillDir, 'templates', 'template.txt'),
			templateContent,
			'utf-8',
		);

		// Create example helper script (Python)
		const scriptContent = `#!/usr/bin/env python3
"""
Helper script for ${skillName}

Usage:
    python scripts/helper.py <input_file>
"""

import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python helper.py <input_file>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    print(f"Processing {input_file}...")
    
    # Add your processing logic here
    
    print("Done!")

if __name__ == "__main__":
    main()
`;
		await writeFile(
			join(skillDir, 'scripts', 'helper.py'),
			scriptContent,
			'utf-8',
		);

		return {
			success: true,
			path: skillDir,
		};
	} catch (error) {
		return {
			success: false,
			path: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

// Register /skills command
registerCommand('skills', {
	execute: async (): Promise<CommandResult> => {
		return {
			success: true,
			action: 'showSkillsCreation',
			message: 'Opening Skills creation dialog...',
		};
	},
});

export default {};
