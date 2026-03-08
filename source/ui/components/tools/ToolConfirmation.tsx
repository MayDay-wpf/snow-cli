import React, {useState, useMemo, useEffect} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import {isSensitiveCommand} from '../../../utils/execution/sensitiveCommandManager.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';
import {vscodeConnection} from '../../../utils/ui/vscodeConnection.js';
import {unifiedHooksExecutor} from '../../../utils/execution/unifiedHooksExecutor.js';
import type {HookErrorDetails} from '../../../utils/execution/hookResultHandler.js';
import fs from 'fs';

export type ConfirmationResult =
	| 'approve'
	| 'approve_always'
	| 'reject'
	| {type: 'reject_with_reply'; reason: string};

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

interface Props {
	toolName: string;
	toolArguments?: string; // JSON string of tool arguments
	allTools?: ToolCall[]; // All tools when confirming multiple tools in parallel
	onConfirm: (result: ConfirmationResult) => void;
	onHookError?: (error: HookErrorDetails) => void; // Hook error callback
}

// Helper function to format argument values with truncation
function formatArgumentValue(
	value: any,
	maxLength: number = 100,
	noTruncate: boolean = false,
): string {
	if (value === null || value === undefined) {
		return String(value);
	}

	const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

	// Skip truncation if noTruncate is true
	if (noTruncate || stringValue.length <= maxLength) {
		return stringValue;
	}

	return stringValue.substring(0, maxLength) + '...';
}

// Helper function to convert parsed arguments to tree display format
function formatArgumentsAsTree(
	args: Record<string, any>,
	toolName?: string,
): Array<{key: string; value: string; isLast: boolean}> {
	// For filesystem-create and filesystem-edit, exclude content fields
	const excludeFields = new Set<string>();

	if (toolName === 'filesystem-create') {
		excludeFields.add('content');
	}
	if (toolName === 'filesystem-edit') {
		excludeFields.add('newContent');
	}
	if (toolName === 'filesystem-edit_search') {
		excludeFields.add('searchContent');
		excludeFields.add('replaceContent');
	}

	// For ACE tools, exclude large result fields that may contain extensive code
	if (toolName?.startsWith('ace-')) {
		excludeFields.add('context'); // ACE tools may return large context strings
		excludeFields.add('signature'); // Function signatures can be verbose
	}

	// terminal-execute 的 command 默认也要截断，避免确认框过长。
	// 需要查看完整命令时，由下方的“翻阅窗口(Tab)”提供分页浏览。

	const keys = Object.keys(args).filter(key => !excludeFields.has(key));
	return keys.map((key, index) => ({
		key,
		value: formatArgumentValue(args[key], 100, false),
		isLast: index === keys.length - 1,
	}));
}

export default function ToolConfirmation({
	toolName,
	toolArguments,
	allTools,
	onConfirm,
	onHookError,
}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const {stdout} = useStdout();
	const [terminalColumns, setTerminalColumns] = useState<number>(
		stdout?.columns ?? process.stdout.columns ?? 80,
	);
	const [terminalRows, setTerminalRows] = useState<number>(
		stdout?.rows ?? process.stdout.rows ?? 24,
	);

	useEffect(() => {
		const nextColumns = stdout?.columns ?? process.stdout.columns;
		const nextRows = stdout?.rows ?? process.stdout.rows;
		if (typeof nextColumns === 'number') {
			setTerminalColumns(nextColumns);
		}
		if (typeof nextRows === 'number') {
			setTerminalRows(nextRows);
		}

		// Ink 的 stdout 通常是 TTY stream，resize 时更新终端尺寸。
		const handler = () => {
			const cols = stdout?.columns ?? process.stdout.columns;
			const rows = stdout?.rows ?? process.stdout.rows;
			if (typeof cols === 'number') {
				setTerminalColumns(cols);
			}
			if (typeof rows === 'number') {
				setTerminalRows(rows);
			}
		};

		stdout?.on?.('resize', handler);
		return () => {
			stdout?.off?.('resize', handler);
		};
	}, [stdout]);

	const [hasSelected, setHasSelected] = useState(false);
	const [showRejectInput, setShowRejectInput] = useState(false);

	const [rejectReason, setRejectReason] = useState('');
	const [menuKey, setMenuKey] = useState(0);
	const [initialMenuIndex, setInitialMenuIndex] = useState(0);
	// terminal-execute 命令翻阅窗口：固定高度分页，Tab 循环翻阅，不一次性完整显示。
	const [commandPageOffset, setCommandPageOffset] = useState(0);

	// 多工具并行列表翻阅窗口：固定高度分页，Tab 循环翻阅，避免确认框因列表过高而抖动。
	const [multiToolPageIndex, setMultiToolPageIndex] = useState(0);

	// Check if this is a sensitive command (for terminal-execute)
	const sensitiveCommandCheck = useMemo(() => {
		if (toolName !== 'terminal-execute' || !toolArguments) {
			return {isSensitive: false};
		}

		try {
			const parsed = JSON.parse(toolArguments);
			const command = parsed.command;
			if (command && typeof command === 'string') {
				return isSensitiveCommand(command);
			}
		} catch {
			// Ignore parse errors
		}

		return {isSensitive: false};
	}, [toolName, toolArguments]);

	// Parse and format tool arguments for display (single tool)
	const formattedArgs = useMemo(() => {
		if (!toolArguments) return null;

		try {
			const parsed = JSON.parse(toolArguments);
			return formatArgumentsAsTree(parsed, toolName);
		} catch {
			return null;
		}
	}, [toolArguments, toolName]);

	// 仅 terminal-execute 展示命令翻阅窗口
	const terminalCommand = useMemo(() => {
		if (toolName !== 'terminal-execute' || !toolArguments) {
			return null;
		}

		try {
			const parsed = JSON.parse(toolArguments);
			const command = parsed.command;
			return typeof command === 'string' ? command : null;
		} catch {
			return null;
		}
	}, [toolName, toolArguments]);

	useEffect(() => {
		// 切换到新命令时重置翻阅位置
		setCommandPageOffset(0);
	}, [terminalCommand]);

	const commandPager = useMemo(() => {
		if (!terminalCommand) return null;
		const maxLines = 3;
		const reserved = 24;
		const lineWidth = Math.max(20, terminalColumns - reserved);
		const windowChars = lineWidth * maxLines;

		const totalPages = Math.max(
			1,
			Math.ceil(terminalCommand.length / windowChars),
		);
		const normalizedOffset =
			totalPages <= 1
				? 0
				: ((commandPageOffset % (totalPages * windowChars)) +
						totalPages * windowChars) %
				  (totalPages * windowChars);

		const slice = terminalCommand.slice(
			normalizedOffset,
			normalizedOffset + windowChars,
		);
		const lines: string[] = [];
		for (let i = 0; i < maxLines; i++) {
			lines.push(slice.slice(i * lineWidth, (i + 1) * lineWidth));
		}

		return {
			lines,
			maxLines,
			lineWidth,
			windowChars,
			totalPages,
			pageIndex: Math.floor(normalizedOffset / windowChars) + 1,
			canPage: totalPages > 1,
		};
	}, [terminalCommand, commandPageOffset, terminalColumns]);

	// Trigger toolConfirmation Hook when component mounts
	useEffect(() => {
		const context = {
			toolName,
			args: toolArguments,
			isSensitive: sensitiveCommandCheck.isSensitive,
			allTools: allTools?.map(t => ({
				name: t.function.name,
				arguments: t.function.arguments,
			})),
		};

		// Execute hook and handle exit code
		unifiedHooksExecutor
			.executeHooks('toolConfirmation', context)
			.then((result: any) => {
				// Check for command failures
				const commandError = result.results.find(
					(r: any) => r.type === 'command' && !r.success,
				);

				if (commandError && commandError.type === 'command') {
					const {exitCode, command, output, error} = commandError;

					if (exitCode === 1) {
						// Warning: print to console
						const combinedOutput =
							[output, error].filter(Boolean).join('\n\n') || '(no output)';
						console.warn(
							`[Hook Warning] toolConfirmation Hook returned warning:\nCommand: ${command}\nOutput: ${combinedOutput}`,
						);
					} else if (exitCode >= 2 || exitCode < 0) {
						// Critical error: send to chat area and close confirmation
						if (onHookError) {
							onHookError({
								type: 'error',
								exitCode,
								command,
								output,
								error,
							});
						}
						// Close confirmation dialog with reject
						setHasSelected(true);
						onConfirm('reject');
					}
				}
			})
			.catch(error => {
				console.error('Failed to execute toolConfirmation hook:', error);
			});
	}, [toolName, toolArguments, sensitiveCommandCheck.isSensitive, allTools]);
	useEffect(() => {
		// Only show diff for filesystem operations and when VSCode is connected
		if (!vscodeConnection.isConnected()) {
			return;
		}

		// Helper function to show diff for a single tool
		const showDiffForTool = (name: string, args: string): Promise<void>[] => {
			const promises: Promise<void>[] = [];
			try {
				const parsed = JSON.parse(args);

				// Handle filesystem-edit (supports batch editing)
				if (name === 'filesystem-edit' && parsed.filePath) {
					// Parse filePath if it's a JSON string (batch mode)
					let filePathData = parsed.filePath;
					if (typeof filePathData === 'string') {
						try {
							filePathData = JSON.parse(filePathData);
						} catch {
							// Not JSON, treat as single file path
						}
					}

					// Check if it's batch editing (array of file configs)
					if (Array.isArray(filePathData)) {
						// Batch mode: filePath is array of {path, startLine, endLine, newContent}
						for (const fileConfig of filePathData) {
							const filePath =
								typeof fileConfig === 'string' ? fileConfig : fileConfig.path;
							const newContent =
								typeof fileConfig === 'string'
									? parsed.newContent
									: fileConfig.newContent;

							if (
								typeof filePath === 'string' &&
								newContent &&
								fs.existsSync(filePath)
							) {
								const originalContent = fs.readFileSync(filePath, 'utf-8');
								promises.push(
									vscodeConnection
										.showDiff(filePath, originalContent, newContent, 'Edit')
										.catch(() => {
											// Silently fail if diff cannot be shown
										}),
								);
							}
						}
					} else if (typeof parsed.filePath === 'string' && parsed.newContent) {
						// Single file mode
						const filePath = parsed.filePath;
						if (fs.existsSync(filePath)) {
							const originalContent = fs.readFileSync(filePath, 'utf-8');
							promises.push(
								vscodeConnection
									.showDiff(
										filePath,
										originalContent,
										parsed.newContent,
										'Edit',
									)
									.catch(() => {
										// Silently fail if diff cannot be shown
									}),
							);
						}
					}
				}

				// Handle filesystem-edit_search (supports batch editing)
				if (name === 'filesystem-edit_search' && parsed.filePath) {
					// Parse filePath if it's a JSON string (batch mode)
					let filePathData = parsed.filePath;
					if (typeof filePathData === 'string') {
						try {
							filePathData = JSON.parse(filePathData);
						} catch {
							// Not JSON, treat as single file path
						}
					}

					// Check if it's batch editing (array of file configs)
					if (Array.isArray(filePathData)) {
						// Batch mode: filePath is array of {path, searchContent, replaceContent}
						for (const fileConfig of filePathData) {
							const filePath =
								typeof fileConfig === 'string' ? fileConfig : fileConfig.path;
							const searchContent =
								typeof fileConfig === 'string'
									? parsed.searchContent
									: fileConfig.searchContent;
							const replaceContent =
								typeof fileConfig === 'string'
									? parsed.replaceContent
									: fileConfig.replaceContent;

							if (
								typeof filePath === 'string' &&
								searchContent &&
								replaceContent &&
								fs.existsSync(filePath)
							) {
								const originalContent = fs.readFileSync(filePath, 'utf-8');
								const newContent = originalContent.replace(
									searchContent,
									replaceContent,
								);
								promises.push(
									vscodeConnection
										.showDiff(
											filePath,
											originalContent,
											newContent,
											'Search & Replace',
										)
										.catch(() => {
											// Silently fail if diff cannot be shown
										}),
								);
							}
						}
					} else if (
						typeof parsed.filePath === 'string' &&
						parsed.searchContent &&
						parsed.replaceContent
					) {
						// Single file mode
						const filePath = parsed.filePath;
						if (fs.existsSync(filePath)) {
							const originalContent = fs.readFileSync(filePath, 'utf-8');
							const newContent = originalContent.replace(
								parsed.searchContent,
								parsed.replaceContent,
							);
							promises.push(
								vscodeConnection
									.showDiff(
										filePath,
										originalContent,
										newContent,
										'Search & Replace',
									)
									.catch(() => {
										// Silently fail if diff cannot be shown
									}),
							);
						}
					}
				}

				// Handle filesystem-create
				if (name === 'filesystem-create' && parsed.filePath && parsed.content) {
					const filePath = parsed.filePath;
					if (typeof filePath === 'string') {
						promises.push(
							vscodeConnection
								.showDiff(filePath, '', parsed.content, 'Create')
								.catch(() => {
									// Silently fail if diff cannot be shown
								}),
						);
					}
				}
			} catch {
				// Ignore parse errors
			}
			return promises;
		};

		// Handle parallel tools
		if (allTools && allTools.length > 0) {
			// Show diff for all filesystem operations in parallel tools
			const diffPromises = allTools.flatMap(tool =>
				showDiffForTool(tool.function.name, tool.function.arguments),
			);

			// Wait for all diffs to be shown
			Promise.all(diffPromises).catch(() => {
				// Silently fail
			});
		} else if (toolArguments) {
			// Handle single tool
			const promises = showDiffForTool(toolName, toolArguments);
			Promise.all(promises).catch(() => {
				// Silently fail
			});
		}

		// Cleanup: close diff when component unmounts
		return () => {
			if (vscodeConnection.isConnected()) {
				vscodeConnection.closeDiff().catch(() => {
					// Silently fail if close fails
				});
			}
		};
	}, [toolName, toolArguments, allTools]);

	// Parse and format all tools arguments for display (multiple tools)
	const formattedAllTools = useMemo<Array<{
		name: string;
		args: Array<{key: string; value: string; isLast: boolean}>;
		estimatedRows: number;
	}> | null>(() => {
		if (!allTools || allTools.length === 0) return null;

		return allTools.map(tool => {
			try {
				const parsed = JSON.parse(tool.function.arguments);
				const args = formatArgumentsAsTree(parsed, tool.function.name);
				return {
					name: tool.function.name,
					args,
					estimatedRows: 1 + args.length + 1,
				};
			} catch {
				return {
					name: tool.function.name,
					args: [],
					estimatedRows: 2,
				};
			}
		});
	}, [allTools]);

	useEffect(() => {
		setMultiToolPageIndex(0);
	}, [formattedAllTools]);

	const multiToolPager = useMemo<{
		pageSize: number;
		totalPages: number;
		pageIndex: number;
		pageStartIndex: number;
		tools: Array<{
			name: string;
			args: Array<{key: string; value: string; isLast: boolean}>;
			estimatedRows: number;
		}>;
		canPage: boolean;
	} | null>(() => {
		if (!formattedAllTools || formattedAllTools.length === 0) {
			return null;
		}
		const reservedRows = 25;

		const availableRows = Math.max(4, terminalRows - reservedRows);

		const pages: Array<typeof formattedAllTools> = [];
		let currentPage: typeof formattedAllTools = [];
		let currentRows = 0;

		for (const tool of formattedAllTools) {
			const toolRows = Math.max(2, tool.estimatedRows);
			const wouldOverflow =
				currentPage.length > 0 && currentRows + toolRows > availableRows;

			if (wouldOverflow) {
				pages.push(currentPage);
				currentPage = [];
				currentRows = 0;
			}

			currentPage.push(tool);
			currentRows += toolRows;
		}

		if (currentPage.length > 0) {
			pages.push(currentPage);
		}

		const totalPages = Math.max(1, pages.length);
		const normalizedPageIndex =
			totalPages <= 1
				? 0
				: ((multiToolPageIndex % totalPages) + totalPages) % totalPages;
		const currentTools = pages[normalizedPageIndex] ?? [];
		const pageStartIndex = pages
			.slice(0, normalizedPageIndex)
			.reduce((sum, page) => sum + page.length, 0);

		return {
			pageSize: currentTools.length,
			totalPages,
			pageIndex: normalizedPageIndex + 1,
			pageStartIndex,
			tools: currentTools,
			canPage: totalPages > 1,
		};
	}, [formattedAllTools, multiToolPageIndex, terminalRows]);

	// Conditionally show "Always approve" based on sensitive command check
	const items = useMemo(() => {
		const baseItems: Array<{label: string; value: string}> = [
			{
				label: t.toolConfirmation.approveOnce,
				value: 'approve',
			},
		];

		// Only show "Always approve" if NOT a sensitive command
		if (!sensitiveCommandCheck.isSensitive) {
			baseItems.push({
				label: t.toolConfirmation.alwaysApprove,
				value: 'approve_always',
			});
		}

		baseItems.push({
			label: t.toolConfirmation.rejectWithReply,
			value: 'reject_with_reply',
		});

		baseItems.push({
			label: t.toolConfirmation.rejectEndSession,
			value: 'reject',
		});

		return baseItems;
	}, [sensitiveCommandCheck.isSensitive, t]);

	useInput((_input, key) => {
		if (key.tab && !hasSelected && !showRejectInput) {
			// Tab - terminal-execute 命令翻阅（循环）
			if (toolName === 'terminal-execute' && commandPager?.canPage) {
				setCommandPageOffset(prev => prev + commandPager.windowChars);
				return;
			}

			// Tab - 多工具并行列表翻页（循环）
			if (multiToolPager?.canPage) {
				setMultiToolPageIndex(prev => prev + 1);
				return;
			}
		}

		// ESC - exit reject input mode
		if (showRejectInput && key.escape) {
			setShowRejectInput(false);
			setRejectReason('');
			// Keep menu selection on "Reject with reply" after ESC
			const idx = items.findIndex(i => i.value === 'reject_with_reply');
			setInitialMenuIndex(idx >= 0 ? idx : 0);
			setMenuKey(k => k + 1);
		}
	});

	const handleSelect = (item: {label: string; value: string}) => {
		if (!hasSelected) {
			if (item.value === 'reject_with_reply') {
				setShowRejectInput(true);
			} else {
				setHasSelected(true);
				onConfirm(item.value as ConfirmationResult);
			}
		}
	};

	const handleRejectReasonSubmit = () => {
		if (!hasSelected && rejectReason.trim()) {
			setHasSelected(true);
			onConfirm({type: 'reject_with_reply', reason: rejectReason.trim()});
		}
	};

	return (
		<Box
			flexDirection="column"
			marginX={1}
			marginY={1}
			borderStyle={'round'}
			borderColor={theme.colors.warning}
			paddingX={1}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.warning}>
					{t.toolConfirmation.header}
				</Text>
			</Box>

			{/* Display single tool */}
			{!formattedAllTools ? (
				<>
					<Box marginBottom={1}>
						<Text>
							{t.toolConfirmation.tool}{' '}
							<Text bold color={theme.colors.menuInfo}>
								{toolName}
							</Text>
						</Text>
					</Box>

					{/* Display sensitive command warning */}
					{sensitiveCommandCheck.isSensitive ? (
						<Box flexDirection="column" marginBottom={1}>
							<Box marginBottom={1}>
								<Text bold color={theme.colors.error}>
									{t.toolConfirmation.sensitiveCommandDetected}
								</Text>
							</Box>

							<Box flexDirection="column" gap={0}>
								<Box>
									<Text dimColor>{t.toolConfirmation.pattern} </Text>
									<Text color="magenta" bold>
										{sensitiveCommandCheck.matchedCommand?.pattern}
									</Text>
								</Box>
							</Box>

							<Box marginTop={1} paddingX={1} paddingY={0}>
								<Text color={theme.colors.warning} italic>
									{t.toolConfirmation.requiresConfirmation}
								</Text>
							</Box>
						</Box>
					) : null}

					{/* Display tool arguments in tree format */}
					{toolName !== 'terminal-execute' && formattedArgs?.length ? (
						<Box flexDirection="column" marginBottom={1}>
							<Text dimColor>{t.toolConfirmation.arguments}</Text>
							{formattedArgs.map((arg, index) => (
								<Box key={index} flexDirection="column">
									<Text color={theme.colors.menuSecondary} dimColor>
										{arg.isLast ? '└─' : '├─'} {arg.key}:{' '}
										<Text color="white">{arg.value}</Text>
									</Text>
								</Box>
							))}
						</Box>
					) : null}

					{/* terminal-execute: 命令翻阅窗口（固定高度，Tab 循环翻页） */}
					{toolName === 'terminal-execute' && commandPager ? (
						<Box flexDirection="column" marginBottom={1}>
							<Text dimColor>
								{t.toolConfirmation.commandPagerTitle}{' '}
								<Text color={theme.colors.menuInfo}>
									{t.toolConfirmation.commandPagerStatus
										.replace('{page}', String(commandPager.pageIndex))
										.replace('{total}', String(commandPager.totalPages))}
								</Text>
							</Text>
							<Box flexDirection="column" paddingLeft={2}>
								{commandPager.lines.map((line, idx) => (
									<Text key={idx} color="white" wrap="truncate">
										{line}
									</Text>
								))}
							</Box>
							{commandPager.canPage ? (
								<Text dimColor>{t.toolConfirmation.commandPagerHint}</Text>
							) : null}
						</Box>
					) : null}
				</>
			) : null}

			{/* Display multiple tools */}
			{formattedAllTools && multiToolPager ? (
				<Box flexDirection="column" marginBottom={1}>
					<Box marginBottom={1}>
						<Text>
							{t.toolConfirmation.tools}{' '}
							<Text bold color={theme.colors.menuInfo}>
								{t.toolConfirmation.toolsInParallel.replace(
									'{count}',
									formattedAllTools.length.toString(),
								)}
							</Text>
						</Text>
					</Box>

					{multiToolPager.tools.map((tool, toolIndex) => {
						const absoluteToolIndex = multiToolPager.pageStartIndex + toolIndex;

						return (
							<Box
								key={absoluteToolIndex}
								flexDirection="column"
								marginBottom={
									toolIndex < multiToolPager.tools.length - 1 ? 1 : 0
								}
							>
								<Text color={theme.colors.menuInfo} bold>
									{absoluteToolIndex + 1}. {tool.name}
								</Text>
								{tool.args.length > 0 && (
									<Box flexDirection="column" paddingLeft={2}>
										{tool.args.map((arg, argIndex) => (
											<Text
												key={argIndex}
												color={theme.colors.menuSecondary}
												dimColor
											>
												{arg.isLast ? '└─' : '├─'} {arg.key}:{' '}
												<Text color="white">{arg.value}</Text>
											</Text>
										))}
									</Box>
								)}
							</Box>
						);
					})}

					{multiToolPager.canPage && (
						<Text dimColor>
							{t.toolConfirmation.multiToolPagerHint
								.replace('{page}', String(multiToolPager.pageIndex))
								.replace('{total}', String(multiToolPager.totalPages))}
						</Text>
					)}
				</Box>
			) : null}

			<Box marginBottom={1}>
				<Text dimColor>{t.toolConfirmation.selectAction}</Text>
			</Box>

			{!hasSelected && !showRejectInput && (
				<SelectInput
					key={menuKey}
					items={items}
					onSelect={handleSelect}
					initialIndex={initialMenuIndex}
				/>
			)}

			{showRejectInput && !hasSelected ? (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.warning}>
							{t.toolConfirmation.enterRejectionReason}
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.menuInfo}>&gt; </Text>
						<TextInput
							value={rejectReason}
							onChange={setRejectReason}
							onSubmit={handleRejectReasonSubmit}
						/>
					</Box>
					<Box>
						<Text dimColor>{t.toolConfirmation.pressEnterToSubmit}</Text>
					</Box>
				</Box>
			) : null}

			{hasSelected && (
				<Box>
					<Text color={theme.colors.success}>
						{t.toolConfirmation.confirmed}
					</Text>
				</Box>
			)}
		</Box>
	);
}
