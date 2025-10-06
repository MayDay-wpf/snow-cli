export function formatTodoContext(
	todos: Array<{
		id: string;
		content: string;
		status: 'pending' | 'in_progress' | 'completed';
	}>
): string {
	if (todos.length === 0) {
		return '';
	}

	const statusSymbol = {
		pending: '[ ]',
		in_progress: '[~]',
		completed: '[x]',
	};

	const lines = [
		'## Current TODO List',
		'',
		...todos.map(
			t => `${statusSymbol[t.status]} ${t.content} (ID: ${t.id})`,
		),
		'',
		'**Important**: Update TODO status immediately after completing each task using todo-update tool.',
		'',
	];

	return lines.join('\n');
}
