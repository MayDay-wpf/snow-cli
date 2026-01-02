import React from 'react';
import {Box, Text} from 'ink';

interface ToolResultPreviewProps {
	toolName: string;
	result: string;
	maxLines?: number;
	isSubAgentInternal?: boolean; // Whether this is a sub-agent internal tool
}

/**
 * Display a compact preview of tool execution results
 * Shows a tree-like structure with limited content
 */
export default function ToolResultPreview({
	toolName,
	result,
	maxLines = 5,
	isSubAgentInternal = false,
}: ToolResultPreviewProps) {
	try {
		// Try to parse JSON result
		const data = JSON.parse(result);

		// Handle different tool types
		if (toolName.startsWith('subagent-')) {
			return renderSubAgentPreview(data, maxLines);
		} else if (toolName === 'terminal-execute') {
			return renderTerminalExecutePreview(data, isSubAgentInternal);
		} else if (toolName === 'filesystem-read') {
			return renderReadPreview(data, isSubAgentInternal);
		} else if (toolName === 'filesystem-create') {
			return renderCreatePreview(data);
		} else if (toolName === 'filesystem-edit_search') {
			return renderEditSearchPreview(data);
		} else if (toolName === 'websearch-search') {
			return renderWebSearchPreview(data, maxLines);
		} else if (toolName === 'websearch-fetch') {
			return renderWebFetchPreview(data);
		} else if (toolName.startsWith('ace-')) {
			return renderACEPreview(toolName, data, maxLines);
		} else if (toolName.startsWith('todo-')) {
			return renderTodoPreview(toolName, data, maxLines);
		} else if (toolName === 'skill-execute') {
			// skill-execute returns a string message, no preview needed
			// (the skill content is displayed elsewhere)
			return null;
		} else {
			// Generic preview for unknown tools
			return renderGenericPreview(data, maxLines);
		}
	} catch {
		// If not JSON or parsing fails, return null (no preview)
		return null;
	}
}

function renderSubAgentPreview(data: any, _maxLines: number) {
	// Sub-agent results have format: { success: boolean, result: string }
	if (!data.result) return null;

	// 简洁显示子代理执行结果
	const lines = data.result.split('\n').filter((line: string) => line.trim());

	return (
		<Box marginLeft={2}>
			<Text color="gray" dimColor>
				└─ Sub-agent completed ({lines.length}{' '}
				{lines.length === 1 ? 'line' : 'lines'} output)
			</Text>
		</Box>
	);
}

function renderTerminalExecutePreview(data: any, isSubAgentInternal: boolean) {
	const hasError = data.exitCode !== 0;
	const hasStdout = data.stdout && data.stdout.trim();
	const hasStderr = data.stderr && data.stderr.trim();

	// For sub-agent internal tools, show minimal info
	if (isSubAgentInternal) {
		return (
			<Box marginLeft={2}>
				<Text color={hasError ? 'red' : 'gray'} dimColor>
					└─ Exit code: {data.exitCode}
					{hasStdout &&
						` (${data.stdout.trim().split('\n').length} lines output)`}
					{hasStderr &&
						` (${data.stderr.trim().split('\n').length} lines stderr)`}
				</Text>
			</Box>
		);
	}

	// Simplified display: only show full output when exitCode !== 0
	const showFullOutput = hasError;

	if (!showFullOutput) {
		// Success case - show stdout directly
		if (!hasStdout) {
			return (
				<Box marginLeft={2}>
					<Text color="green" dimColor>
						└─ ✓ Exit code: {data.exitCode}
					</Text>
				</Box>
			);
		}

		return (
			<Box flexDirection="column" marginLeft={2}>
				<Box flexDirection="column">
					<Text color="green" dimColor>
						├─ command:
					</Text>
					<Box marginLeft={2}>
						<Text color="green">{data.command}</Text>
					</Box>
				</Box>
				<Text color="green" dimColor>
					├─ exitCode: {data.exitCode} ✓
				</Text>
				<Box flexDirection="column">
					<Text color="gray" dimColor>
						├─ stdout:
					</Text>
					<Box marginLeft={2} flexDirection="column">
						{data.stdout.split('\n').map((line: string, idx: number) => (
							<Text key={idx} color="white">
								{line}
							</Text>
						))}
					</Box>
				</Box>
				<Text color="gray" dimColor>
					└─ executedAt: {data.executedAt}
				</Text>
			</Box>
		);
	}

	// Error case - show full details including stderr
	return (
		<Box flexDirection="column" marginLeft={2}>
			{/* Command */}
			<Box flexDirection="column">
				<Text color="gray" dimColor>
					├─ command:
				</Text>
				<Box marginLeft={2}>
					<Text color="gray">{data.command}</Text>
				</Box>
			</Box>

			{/* Exit code with color indication */}
			<Text color="red" bold>
				├─ exitCode: {data.exitCode} FAILED
			</Text>

			{/* Stdout - show completely if present */}
			{hasStdout && (
				<Box flexDirection="column">
					<Text color="gray" dimColor>
						├─ stdout:
					</Text>
					<Box marginLeft={2} flexDirection="column">
						{data.stdout.split('\n').map((line: string, idx: number) => (
							<Text key={idx} color="yellow">
								{line}
							</Text>
						))}
					</Box>
				</Box>
			)}

			{/* Stderr - show completely with red color if present */}
			{hasStderr && (
				<Box flexDirection="column">
					<Text color="red" dimColor>
						├─ stderr:
					</Text>
					<Box marginLeft={2} flexDirection="column">
						{data.stderr.split('\n').map((line: string, idx: number) => (
							<Text key={idx} color="red">
								{line}
							</Text>
						))}
					</Box>
				</Box>
			)}

			{/* Execution time if available */}
			{data.executedAt && (
				<Text color="gray" dimColor>
					└─ executedAt: {data.executedAt}
				</Text>
			)}
		</Box>
	);
}

function renderReadPreview(data: any, isSubAgentInternal: boolean) {
	if (!data.content) return null;

	// 简洁显示：只显示读取的行数信息
	const lines = data.content.split('\n');
	const readLineCount = lines.length;
	const totalLines = data.totalLines || readLineCount;

	// For sub-agent internal tools, show even more minimal info
	if (isSubAgentInternal) {
		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ Read {readLineCount} lines
					{totalLines > readLineCount ? ` of ${totalLines} total` : ''}
				</Text>
			</Box>
		);
	}

	// 如果是读取部分行，显示范围
	const rangeInfo =
		data.startLine && data.endLine
			? ` (lines ${data.startLine}-${data.endLine})`
			: '';

	return (
		<Box marginLeft={2}>
			<Text color="gray" dimColor>
				└─ Read {readLineCount} lines{rangeInfo}
				{totalLines > readLineCount ? ` of ${totalLines} total` : ''}
			</Text>
		</Box>
	);
}

function renderACEPreview(toolName: string, data: any, maxLines: number) {
	// Handle ace-text-search results
	if (toolName === 'ace-text-search' || toolName === 'ace-text_search') {
		if (!data || data.length === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No matches found
					</Text>
				</Box>
			);
		}

		const results = Array.isArray(data) ? data : [];
		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ Found {results.length} {results.length === 1 ? 'match' : 'matches'}
				</Text>
			</Box>
		);
	}

	// Handle ace-search-symbols results
	if (toolName === 'ace-search-symbols' || toolName === 'ace-search_symbols') {
		const symbols = data.symbols || [];
		if (symbols.length === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No symbols found
					</Text>
				</Box>
			);
		}

		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ Found {symbols.length}{' '}
					{symbols.length === 1 ? 'symbol' : 'symbols'}
				</Text>
			</Box>
		);
	}

	// Handle ace-find-references results
	if (
		toolName === 'ace-find-references' ||
		toolName === 'ace-find_references'
	) {
		const references = Array.isArray(data) ? data : [];
		if (references.length === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No references found
					</Text>
				</Box>
			);
		}

		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ Found {references.length}{' '}
					{references.length === 1 ? 'reference' : 'references'}
				</Text>
			</Box>
		);
	}

	// Handle ace-find-definition result
	if (
		toolName === 'ace-find-definition' ||
		toolName === 'ace-find_definition'
	) {
		if (!data) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ Definition not found
					</Text>
				</Box>
			);
		}

		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ Found {data.type} {data.name} at {data.filePath}:{data.line}
				</Text>
			</Box>
		);
	}

	// Handle ace-file-outline result
	if (toolName === 'ace-file-outline' || toolName === 'ace-file_outline') {
		const symbols = Array.isArray(data) ? data : [];
		if (symbols.length === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No symbols in file
					</Text>
				</Box>
			);
		}

		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ Found {symbols.length}{' '}
					{symbols.length === 1 ? 'symbol' : 'symbols'} in file
				</Text>
			</Box>
		);
	}

	// Handle ace-semantic-search result
	if (
		toolName === 'ace-semantic-search' ||
		toolName === 'ace-semantic_search'
	) {
		const totalResults =
			(data.symbols?.length || 0) + (data.references?.length || 0);
		if (totalResults === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No results found
					</Text>
				</Box>
			);
		}

		return (
			<Box flexDirection="column" marginLeft={2}>
				<Text color="gray" dimColor>
					├─ {data.symbols?.length || 0}{' '}
					{(data.symbols?.length || 0) === 1 ? 'symbol' : 'symbols'}
				</Text>
				<Text color="gray" dimColor>
					└─ {data.references?.length || 0}{' '}
					{(data.references?.length || 0) === 1 ? 'reference' : 'references'}
				</Text>
			</Box>
		);
	}

	// Generic ACE tool preview
	return renderGenericPreview(data, maxLines);
}

function renderCreatePreview(data: any) {
	// Simple success message for create/write operations
	return (
		<Box marginLeft={2}>
			<Text color="gray" dimColor>
				└─ {data.message || data}
			</Text>
		</Box>
	);
}

function renderEditSearchPreview(data: any) {
	// For edit_search, show only key metadata, exclude searchContent and replaceContent
	return (
		<Box flexDirection="column" marginLeft={2}>
			{data.message && (
				<Text color="gray" dimColor>
					├─ {data.message}
				</Text>
			)}
			{data.matchLocation && (
				<Text color="gray" dimColor>
					├─ Match: lines {data.matchLocation.startLine}-
					{data.matchLocation.endLine}
				</Text>
			)}
			{data.totalLines && (
				<Text color="gray" dimColor>
					└─ Total lines: {data.totalLines}
				</Text>
			)}
		</Box>
	);
}

function renderWebSearchPreview(data: any, _maxLines: number) {
	if (!data.results || data.results.length === 0) {
		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ No results for "{data.query}"
				</Text>
			</Box>
		);
	}

	return (
		<Box marginLeft={2}>
			<Text color="gray" dimColor>
				└─ Found {data.totalResults || data.results.length} results for "
				{data.query}"
			</Text>
		</Box>
	);
}

function renderWebFetchPreview(data: any) {
	const contentLength = data.textLength || data.content?.length || 0;
	return (
		<Box marginLeft={2}>
			<Text color="gray" dimColor>
				└─ Fetched {contentLength} characters from {data.title || 'page'}
			</Text>
		</Box>
	);
}

function renderGenericPreview(data: any, maxLines: number) {
	// Guard: if data is not an object (e.g., it's a string), skip preview
	// This prevents Object.entries from treating strings as character arrays
	if (typeof data !== 'object' || data === null) {
		return null;
	}

	// For unknown tool types, show first few properties
	const entries = Object.entries(data).slice(0, maxLines);
	if (entries.length === 0) return null;

	return (
		<Box flexDirection="column" marginLeft={2}>
			{entries.map(([key, value], idx) => {
				const valueStr =
					typeof value === 'string'
						? value.slice(0, 20) + (value.length > 20 ? '...' : '')
						: JSON.stringify(value).slice(0, 60);

				return (
					<Text key={idx} color="gray" dimColor>
						{idx === entries.length - 1 ? '└─ ' : '├─ '}
						{key}: {valueStr}
					</Text>
				);
			})}
		</Box>
	);
}

function renderTodoPreview(_toolName: string, data: any, _maxLines: number) {
	// Handle todo-get, todo-update, todo-add, todo-delete

	// Debug: Check if data is actually the stringified result that needs parsing again
	// Some tools might return the result wrapped in content[0].text
	let todoData = data;

	// If data has content array (MCP format), extract the text
	if (data.content && Array.isArray(data.content) && data.content[0]?.text) {
		const textContent = data.content[0].text;

		// Skip parsing if it's a plain message string
		if (
			textContent === 'No TODO list found' ||
			textContent === 'TODO item not found'
		) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ {textContent}
					</Text>
				</Box>
			);
		}

		// Try to parse JSON
		try {
			todoData = JSON.parse(textContent);
		} catch (e) {
			// If parsing fails, show the raw text
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ {textContent}
					</Text>
				</Box>
			);
		}
	}

	// Check if we have valid todo data
	if (!todoData.todos || !Array.isArray(todoData.todos)) {
		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ {todoData.message || 'No TODO list'}
				</Text>
			</Box>
		);
	}

	// 只显示简洁的 TODO 状态提示，不显示完整的 TodoTree
	const totalTodos = todoData.todos.length;
	const completedTodos = todoData.todos.filter(
		(todo: any) => todo.status === 'completed',
	).length;
	const pendingTodos = totalTodos - completedTodos;

	return (
		<Box marginLeft={2}>
			<Text color="gray" dimColor>
				└─ TODO: {pendingTodos} pending, {completedTodos} completed (total:{' '}
				{totalTodos})
			</Text>
		</Box>
	);
}
