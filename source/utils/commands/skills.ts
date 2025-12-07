import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {homedir} from 'os';
import {join} from 'path';
import {mkdir, writeFile} from 'fs/promises';
import {existsSync} from 'fs';

// Skill template metadata
export interface SkillMetadata {
	name: string;
	description: string;
}

// Skill location type
export type SkillLocation = 'global' | 'project';

// Validate skill name (lowercase letters, numbers, hyphens only, max 64 chars)
export function validateSkillName(name: string): {
	valid: boolean;
	error?: string;
} {
	if (!name || name.trim().length === 0) {
		return {valid: false, error: 'Skill name cannot be empty'};
	}

	const trimmedName = name.trim();

	if (trimmedName.length > 64) {
		return {valid: false, error: 'Skill name must be 64 characters or less'};
	}

	const validNamePattern = /^[a-z0-9-]+$/;
	if (!validNamePattern.test(trimmedName)) {
		return {
			valid: false,
			error:
				'Skill name must contain only lowercase letters, numbers, and hyphens',
		};
	}

	return {valid: true};
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
	if (location === 'global') {
		return join(homedir(), '.snow', 'skills', skillName);
	} else {
		const root = projectRoot || process.cwd();
		return join(root, '.snow', 'skills', skillName);
	}
}

// Generate SKILL.md content
export function generateSkillTemplate(metadata: SkillMetadata): string {
	return `---
name: ${metadata.name}
description: ${metadata.description}
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

		// Generate and write SKILL.md
		const skillContent = generateSkillTemplate({name: skillName, description});
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
