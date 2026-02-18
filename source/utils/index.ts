import {Command} from '../types/index.js';

// Import commands to register them
import './commands/addDir.js';
import './commands/agent.js';
import './commands/clear.js';
import './commands/compact.js';
import './commands/custom.js';
import './commands/diff.js';
import './commands/export.js';
import './commands/help.js';
import './commands/home.js';
import './commands/ide.js';
import './commands/init.js';
import './commands/mcp.js';
import './commands/plan.js';
import './commands/quit.js';
import './commands/reindex.js';
import './commands/resume.js';
import './commands/review.js';
import './commands/role.js';
import './commands/skills.js';
import './commands/skillsPicker.js';
import './commands/todoPicker.js';
import './commands/usage.js';
import './commands/vulnerability-hunting.js';
import './commands/yolo.js';

// Export logger
export {Logger, LogLevel, logger} from './core/logger.js';
export {default as defaultLogger} from './core/logger.js';

// Export unified hooks executor
export {
	UnifiedHooksExecutor,
	unifiedHooksExecutor,
	type UnifiedHookExecutionResult,
	type HookActionResult,
	type CommandHookResult,
	type PromptHookResult,
} from './execution/unifiedHooksExecutor.js';

export function formatCommand(command: Command): string {
	return `${command.name.padEnd(12)} ${command.description}`;
}

export function parseInput(input: string): {command: string; args: string[]} {
	const parts = input.trim().split(' ');
	const command = parts[0] || '';
	const args = parts.slice(1);
	return {command, args};
}

export function sanitizeInput(input: string): string {
	return input.trim().replace(/[<>]/g, '');
}
