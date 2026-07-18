export interface FormatTodoContextOptions {
	/**
	 * 是否为追问场景（session 已存在历史消息）。
	 * 为 true 且存在未完成 TODO 时，会注入指令引导 AI 主动调用 get 恢复 TODO 上下文。
	 */
	isFollowUp?: boolean;
	/**
	 * 是否为 Ultra TODO 模式，决定引导调用 todo-ultra 还是 todo-manage。
	 */
	ultraMode?: boolean;
}

export function formatTodoContext(
	todos: Array<{
		id: string;
		content: string;
		status: 'pending' | 'inProgress' | 'completed';
	}>,
	options?: FormatTodoContextOptions,
): string {
	if (todos.length === 0) {
		return '';
	}

	const statusSymbol = {
		pending: '[ ]',
		inProgress: '[~]',
		completed: '[x]',
	};

	const lines = [
		'## Current TODO List',
		'',
		...todos.map(t => `${statusSymbol[t.status]} ${t.content} (ID: ${t.id})`),
		'',
		'**Important**: Update TODO status immediately after completing each task using todo-manage with action "update".',
		'',
	];

	// 追问场景且存在未完成 TODO 时，引导 AI 主动调用 get 恢复 TODO 上下文，
	// 避免 AI 在追问后忘记拉起 TODO 列表导致后续交互脱离 TODO 工作流。
	const hasIncomplete = todos.some(t => t.status !== 'completed');
	if (options?.isFollowUp && hasIncomplete) {
		const toolName = options.ultraMode ? 'todo-ultra' : 'todo-manage';
		lines.push(
			`**Action Required**: This is a follow-up message with an active TODO list. You MUST call \`${toolName}({action: "get"})\` first (paired with an action tool) to restore your TODO session context before doing any other work. This ensures the TODO list stays in sync and you continue using the TODO workflow for this task.`,
			'',
		);
	}

	return lines.join('\n');
}
