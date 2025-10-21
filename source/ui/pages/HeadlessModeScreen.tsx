import React, {useState, useEffect} from 'react';
import {useStdout} from 'ink';
import ansiEscapes from 'ansi-escapes';
import {highlight} from 'cli-highlight';
import {type Message} from '../components/MessageList.js';
import {handleConversationWithTools} from '../../hooks/useConversation.js';
import {useStreamingState} from '../../hooks/useStreamingState.js';
import {useToolConfirmation} from '../../hooks/useToolConfirmation.js';
import {useVSCodeState} from '../../hooks/useVSCodeState.js';
import {useUsagePersistence} from '../../hooks/useUsagePersistence.js';
import {getOpenAiConfig} from '../../utils/apiConfig.js';
import {
	parseAndValidateFileReferences,
	createMessageWithFileInstructions,
	getSystemInfo,
} from '../../utils/fileUtils.js';

type Props = {
	prompt: string;
	onComplete: () => void;
};

// Console-based markdown renderer functions
function renderConsoleMarkdown(content: string): string {
	const blocks = parseConsoleMarkdown(content);
	return blocks.map(block => renderConsoleBlock(block)).join('\n');
}

function parseConsoleMarkdown(content: string): any[] {
	const blocks: any[] = [];
	const lines = content.split('\n');
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] ?? '';

		// Check for code block
		const codeBlockMatch = line.match(/^```(.*)$/);
		if (codeBlockMatch) {
			const language = codeBlockMatch[1]?.trim() || '';
			const codeLines: string[] = [];
			i++;

			// Collect code block lines
			while (i < lines.length) {
				const currentLine = lines[i] ?? '';
				if (currentLine.trim().startsWith('```')) {
					break;
				}
				codeLines.push(currentLine);
				i++;
			}

			blocks.push({
				type: 'code',
				language,
				code: codeLines.join('\n'),
			});
			i++; // Skip closing ```
			continue;
		}

		// Check for heading
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			blocks.push({
				type: 'heading',
				level: headingMatch[1]!.length,
				content: headingMatch[2]!.trim(),
			});
			i++;
			continue;
		}

		// Check for list item
		const listMatch = line.match(/^[\s]*[*\-]\s+(.+)$/);
		if (listMatch) {
			const listItems: string[] = [listMatch[1]!.trim()];
			i++;

			// Collect consecutive list items
			while (i < lines.length) {
				const currentLine = lines[i] ?? '';
				const nextListMatch = currentLine.match(/^[\s]*[*\-]\s+(.+)$/);
				if (!nextListMatch) {
					break;
				}
				listItems.push(nextListMatch[1]!.trim());
				i++;
			}

			blocks.push({
				type: 'list',
				items: listItems,
			});
			continue;
		}

		// Collect text lines
		const textLines: string[] = [];
		while (i < lines.length) {
			const currentLine = lines[i] ?? '';
			if (
				currentLine.trim().startsWith('```') ||
				currentLine.match(/^#{1,6}\s+/) ||
				currentLine.match(/^[\s]*[*\-]\s+/)
			) {
				break;
			}
			textLines.push(currentLine);
			i++;
		}

		if (textLines.length > 0) {
			blocks.push({
				type: 'text',
				content: textLines.join('\n'),
			});
		}
	}

	return blocks;
}

function renderConsoleBlock(block: any): string {
	switch (block.type) {
		case 'code': {
			const highlightedCode = highlightConsoleCode(block.code, block.language);
			const languageLabel = block.language
				? `\x1b[42m\x1b[30m ${block.language} \x1b[0m`
				: '';

			return (
				`\n\x1b[90m┌─ Code Block\x1b[0m\n` +
				(languageLabel ? `\x1b[90m│\x1b[0m ${languageLabel}\n` : '') +
				`\x1b[90m├─\x1b[0m\n` +
				`${highlightedCode}\n` +
				`\x1b[90m└─ End of Code\x1b[0m`
			);
		}

		case 'heading': {
			const headingColors = ['\x1b[96m', '\x1b[94m', '\x1b[95m', '\x1b[93m'];
			const headingColor = headingColors[block.level - 1] || '\x1b[97m';
			const prefix = '#'.repeat(block.level);
			return `\n${headingColor}${prefix} ${renderInlineFormatting(
				block.content,
			)}\x1b[0m`;
		}

		case 'list': {
			return (
				'\n' +
				block.items
					.map(
						(item: string) =>
							`\x1b[93m•\x1b[0m ${renderInlineFormatting(item)}`,
					)
					.join('\n')
			);
		}

		case 'text': {
			return (
				'\n' +
				block.content
					.split('\n')
					.map((line: string) =>
						line === '' ? '' : renderInlineFormatting(line),
					)
					.join('\n')
			);
		}

		default:
			return '';
	}
}

function highlightConsoleCode(code: string, language: string): string {
	try {
		if (!language) {
			return code
				.split('\n')
				.map(line => `\x1b[90m│ \x1b[37m${line}\x1b[0m`)
				.join('\n');
		}

		// Map common language aliases
		const languageMap: Record<string, string> = {
			js: 'javascript',
			ts: 'typescript',
			py: 'python',
			rb: 'ruby',
			sh: 'bash',
			shell: 'bash',
			cs: 'csharp',
			'c#': 'csharp',
			cpp: 'cpp',
			'c++': 'cpp',
			yml: 'yaml',
			md: 'markdown',
			json: 'json',
			xml: 'xml',
			html: 'html',
			css: 'css',
			sql: 'sql',
			java: 'java',
			go: 'go',
			rust: 'rust',
			php: 'php',
		};

		const mappedLanguage =
			languageMap[language.toLowerCase()] || language.toLowerCase();
		const highlighted = highlight(code, {
			language: mappedLanguage,
			ignoreIllegals: true,
		});

		return highlighted
			.split('\n')
			.map(line => `\x1b[90m│ \x1b[0m${line}`)
			.join('\n');
	} catch {
		// If highlighting fails, return plain code
		return code
			.split('\n')
			.map(line => `\x1b[90m│ \x1b[37m${line}\x1b[0m`)
			.join('\n');
	}
}

function renderInlineFormatting(text: string): string {
	// Handle inline code `code`
	text = text.replace(/`([^`]+)`/g, (_, code) => {
		return `\x1b[36m${code}\x1b[0m`;
	});

	// Handle bold **text** or __text__
	text = text.replace(/(\*\*|__)([^*_]+)\1/g, (_, __, content) => {
		return `\x1b[1m\x1b[97m${content}\x1b[0m`;
	});

	// Handle italic *text* or _text_
	text = text.replace(/(?<!\*)(\*)(?!\*)([^*]+)\1(?!\*)/g, (_, __, content) => {
		return `\x1b[3m\x1b[97m${content}\x1b[0m`;
	});

	return text;
}

export default function HeadlessModeScreen({prompt, onComplete}: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isComplete, setIsComplete] = useState(false);
	const {stdout} = useStdout();

	// Use custom hooks
	const streamingState = useStreamingState();
	const vscodeState = useVSCodeState();
	const {createUsageSaver} = useUsagePersistence();

	// Use tool confirmation hook
	const {
		requestToolConfirmation,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
	} = useToolConfirmation();

	// Listen for message changes to display AI responses and tool calls
	useEffect(() => {
		const lastMessage = messages[messages.length - 1];
		if (!lastMessage) return;

		if (lastMessage.role === 'assistant') {
			if (lastMessage.toolPending) {
				// Tool is being executed - use same icon as ChatScreen with colors
				if (lastMessage.content.startsWith('⚡')) {
					console.log(`\n\x1b[93m⚡ ${lastMessage.content}\x1b[0m`);
				} else if (lastMessage.content.startsWith('✓')) {
					console.log(`\n\x1b[32m✓ ${lastMessage.content}\x1b[0m`);
				} else if (lastMessage.content.startsWith('✗')) {
					console.log(`\n\x1b[31m✗ ${lastMessage.content}\x1b[0m`);
				} else {
					console.log(`\n\x1b[96m❆ ${lastMessage.content}\x1b[0m`);
				}
			} else if (lastMessage.content && !lastMessage.streaming) {
				// Final response with markdown rendering and better formatting
				console.log(renderConsoleMarkdown(lastMessage.content));

				// Show tool results if available with better styling
				if (
					lastMessage.toolCall &&
					lastMessage.toolCall.name === 'terminal-execute'
				) {
					const args = lastMessage.toolCall.arguments;
					if (args.command) {
						console.log(`\n\x1b[90m┌─ Command\x1b[0m`);
						console.log(`\x1b[33m│  ${args.command}\x1b[0m`);
					}
					if (args.stdout && args.stdout.trim()) {
						console.log(`\x1b[90m├─ stdout\x1b[0m`);
						const stdoutLines = args.stdout.split('\n');
						stdoutLines.forEach((line: string) => {
							console.log(`\x1b[90m│  \x1b[32m${line}\x1b[0m`);
						});
					}
					if (args.stderr && args.stderr.trim()) {
						console.log(`\x1b[90m├─ stderr\x1b[0m`);
						const stderrLines = args.stderr.split('\n');
						stderrLines.forEach((line: string) => {
							console.log(`\x1b[90m│  \x1b[31m${line}\x1b[0m`);
						});
					}
					if (args.command || args.stdout || args.stderr) {
						console.log(`\x1b[90m└─ Execution complete\x1b[0m`);
					}
				}
			}
		}
	}, [messages]);

	// Listen for streaming state to show loading status
	useEffect(() => {
		if (streamingState.isStreaming) {
			if (streamingState.retryStatus && streamingState.retryStatus.isRetrying) {
				// Show retry status with colors
				if (streamingState.retryStatus.errorMessage) {
					console.log(
						`\n\x1b[31m✗ Error: ${streamingState.retryStatus.errorMessage}\x1b[0m`,
					);
				}
				if (
					streamingState.retryStatus.remainingSeconds !== undefined &&
					streamingState.retryStatus.remainingSeconds > 0
				) {
					console.log(
						`\n\x1b[93m⟳ Retry \x1b[33m${streamingState.retryStatus.attempt}/5\x1b[93m in \x1b[32m${streamingState.retryStatus.remainingSeconds}s\x1b[93m...\x1b[0m`,
					);
				} else {
					console.log(
						`\n\x1b[93m⟳ Resending... \x1b[33m(Attempt ${streamingState.retryStatus.attempt}/5)\x1b[0m`,
					);
				}
			} else {
				// Show normal thinking status with colors
				const thinkingText = streamingState.isReasoning
					? 'Deep thinking...'
					: 'Thinking...';
				process.stdout.write(
					`\r\x1b[96m❆\x1b[90m ${thinkingText} \x1b[37m(\x1b[33m${streamingState.elapsedSeconds}s\x1b[37m · \x1b[32m↓ ${streamingState.streamTokenCount} tokens\x1b[37m)\x1b[0m`,
				);
			}
		}
	}, [
		streamingState.isStreaming,
		streamingState.isReasoning,
		streamingState.elapsedSeconds,
		streamingState.streamTokenCount,
		streamingState.retryStatus,
	]);
	const processMessage = async () => {
		try {
			// Parse and validate file references
			const {cleanContent, validFiles} = await parseAndValidateFileReferences(
				prompt,
			);
			const regularFiles = validFiles.filter(f => !f.isImage);

			// Get system information
			const systemInfo = getSystemInfo();

			// Add user message to UI
			const userMessage: Message = {
				role: 'user',
				content: cleanContent,
				files: validFiles.length > 0 ? validFiles : undefined,
				systemInfo,
			};
			setMessages([userMessage]);

			streamingState.setIsStreaming(true);

			// Create new abort controller for this request
			const controller = new AbortController();
			streamingState.setAbortController(controller);

			// Clear terminal and start headless output
			stdout.write(ansiEscapes.clearTerminal);

			// Print colorful banner
			console.log(
				`\x1b[94m╭─────────────────────────────────────────────────────────╮\x1b[0m`,
			);
			console.log(
				`\x1b[94m│\x1b[96m                ❆ Snow AI CLI - Headless Mode ❆          \x1b[94m│\x1b[0m`,
			);
			console.log(
				`\x1b[94m╰─────────────────────────────────────────────────────────╯\x1b[0m`,
			);

			// Print user prompt with styling
			console.log(`\n\x1b[36m┌─ User Query\x1b[0m`);
			console.log(`\x1b[97m│  ${cleanContent}\x1b[0m`);

			if (validFiles.length > 0) {
				console.log(`\x1b[36m├─ Files\x1b[0m`);
				validFiles.forEach(file => {
					const statusColor = file.exists ? '\x1b[32m' : '\x1b[31m';
					const statusText = file.exists ? '✓' : '✗';
					console.log(
						`\x1b[90m│  └─ ${statusColor}${statusText}\x1b[90m ${file.path}${
							file.exists
								? `\x1b[33m (${file.lineCount} lines)\x1b[90m`
								: '\x1b[31m (not found)\x1b[90m'
						}\x1b[0m`,
					);
				});
			}

			if (systemInfo) {
				console.log(`\x1b[36m├─ System Context\x1b[0m`);
				console.log(
					`\x1b[90m│  └─ Platform: \x1b[33m${systemInfo.platform}\x1b[0m`,
				);
				console.log(`\x1b[90m│  └─ Shell: \x1b[33m${systemInfo.shell}\x1b[0m`);
				console.log(
					`\x1b[90m│  └─ Working Directory: \x1b[33m${systemInfo.workingDirectory}\x1b[0m`,
				);
			}

			console.log(`\x1b[36m└─ Assistant Response\x1b[0m`);

			// Create message for AI
			const messageForAI = createMessageWithFileInstructions(
				cleanContent,
				regularFiles,
				systemInfo,
				vscodeState.vscodeConnected ? vscodeState.editorContext : undefined,
			);
			// Custom save message function for headless mode
			const saveMessage = async () => {
				// In headless mode, we don't need to save messages
			};

			// Get model name for usage tracking
			const config = getOpenAiConfig();
			const modelName = config.advancedModel || config.basicModel || 'unknown';

			// Start conversation with tool support
			await handleConversationWithTools({
				userContent: messageForAI,
				imageContents: [],
				controller,
				messages,
				saveMessage,
				setMessages,
				setStreamTokenCount: streamingState.setStreamTokenCount,
				setCurrentTodos: () => {}, // No-op in headless mode
				requestToolConfirmation,
				isToolAutoApproved,
				addMultipleToAlwaysApproved,
				yoloMode: true, // Always use YOLO mode in headless
				setContextUsage: streamingState.setContextUsage,
				useBasicModel: false,
				getPendingMessages: () => [],
				clearPendingMessages: () => {},
				setIsStreaming: streamingState.setIsStreaming,
				setIsReasoning: streamingState.setIsReasoning,
				setRetryStatus: streamingState.setRetryStatus,
				onUsageUpdate: createUsageSaver(modelName), // Save usage after each round
			});
		} catch (error) {
			console.error(
				`\n\x1b[31m✗ Error:\x1b[0m`,
				error instanceof Error
					? `\x1b[91m${error.message}\x1b[0m`
					: '\x1b[91mUnknown error occurred\x1b[0m',
			);
		} finally {
			// End streaming
			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
			setIsComplete(true);

			// Wait a moment then call onComplete
			setTimeout(() => {
				onComplete();
			}, 1000);
		}
	};

	useEffect(() => {
		processMessage();
	}, []);

	// Simple console output mode - don't render anything
	if (isComplete) {
		return null;
	}

	// Return empty fragment - we're using console.log for output
	return <></>;
}
