import {Command} from '../types/index.js';

// Import commands to register them
import './commands/addDir.js';
import './commands/agentsInject.js';
import './commands/agent.js';
import './commands/pause.js';
import './commands/continue.js';
import './commands/backend.js';
import './commands/branch.js';
import './commands/buddy.js';
import './commands/btw.js';
import './commands/games.js';
import './commands/clear.js';
import './commands/codebase.js';
import './commands/compact.js';
import './commands/connect.js';
import './commands/copyLast.js';
import './commands/custom.js';
import './commands/deepresearch.js';
import './commands/delSession.js';
import './commands/diff.js';
import './commands/export.js';
import './commands/config.js';
import './commands/gitline.js';
import './commands/goal.js';
import './commands/help.js';
import './commands/home.js';
import './commands/ide.js';
import './commands/init.js';
import './commands/loop.js';
import './commands/mcp.js';
import './commands/models.js';
import './commands/telemetry.js';
import './commands/subagentDepth.js';
import './commands/newPrompt.js';
import './commands/permissions.js';
import './commands/plan.js';
import './commands/profiles.js';
import './commands/quit.js';
import './commands/reindex.js';
import './commands/resume.js';
import './commands/review.js';
import './commands/role.js';
import './commands/simple.js';
import './commands/skills.js';
import './commands/skillsPicker.js';
import './commands/todoPicker.js';
import './commands/todolist.js';
import './commands/toolsearch.js';
import './commands/ultraTodo.js';
import './commands/hybridCompress.js';
import './commands/usage.js';
import './commands/context.js';
import './commands/vulnerability-hunting.js';
import './commands/autoformat.js';
import './commands/team.js';
import './commands/worktree.js';
import './commands/yolo.js';
import './commands/speedometer.js';
import './commands/interrupt.js';

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

// Export hook result interpreter
export {
	interpretHookResult,
	findFirstFailedCommand,
	buildErrorDetails,
	type InterpretedHookResult,
	type HookErrorDetails,
} from './execution/hookResultInterpreter.js';

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
