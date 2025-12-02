import React, {useState, useEffect} from 'react';
import {useStdout} from 'ink';
import ansiEscapes from 'ansi-escapes';
import {highlight} from 'cli-highlight';
import readline from 'readline';
import {type Message} from '../components/MessageList.js';
import {handleConversationWithTools} from '../../hooks/conversation/useConversation.js';
import {useStreamingState} from '../../hooks/conversation/useStreamingState.js';
import {useToolConfirmation} from '../../hooks/conversation/useToolConfirmation.js';
import {useVSCodeState} from '../../hooks/integration/useVSCodeState.js';
import {useSessionSave} from '../../hooks/session/useSessionSave.js';
import {
	parseAndValidateFileReferences,
	createMessageWithFileInstructions,
} from '../../utils/core/fileUtils.js';
import {isSensitiveCommand} from '../../utils/execution/sensitiveCommandManager.js';
import {getCurrentTheme} from '../../utils/config/themeConfig.js';
import {themes} from '../themes/index.js';

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

// Get theme colors
const getTheme = () => {
	const currentTheme = getCurrentTheme();
	return themes[currentTheme].colors;
};

// Helper function to convert theme color to ANSI code
const getAnsiColor = (color: string): string => {
	const colorMap: Record<string, string> = {
		red: '\x1b[31m',
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		blue: '\x1b[34m',
		magenta: '\x1b[35m',
		cyan: '\x1b[36m',
		white: '\x1b[37m',
		gray: '\x1b[90m',
	};
	return colorMap[color] || '\x1b[37m'; // default to white
};

// Helper function to ask user for confirmation in headless mode
async function askHeadlessConfirmation(
	toolName: string,
	toolArguments: string,
): Promise<'approve' | 'reject' | 'approve_always'> {
	return new Promise(resolve => {
		const theme = getTheme();

		// Create readline interface
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		// Parse tool arguments to check if it's a sensitive command
		let command = '';
		try {
			const args = JSON.parse(toolArguments);
			if (args.command) {
				command = args.command;
			}
		} catch {
			// Ignore parsing errors
		}

		// Check if it's a sensitive command
		const sensitiveCheck = isSensitiveCommand(command);

		const warningColor = getAnsiColor(theme.warning);
		const errorColor = getAnsiColor(theme.error);
		const infoColor = getAnsiColor(theme.menuInfo);
		const successColor = getAnsiColor(theme.success);
		const resetColor = '\x1b[0m';

		// Display tool information with theme colors
		console.log(
			`\n${warningColor}⚠ Tool Confirmation Required${resetColor} ${
				sensitiveCheck.isSensitive
					? `${errorColor}(Sensitive Command)${resetColor}`
					: ''
			}`,
		);
		console.log(`${infoColor}Tool:${resetColor} ${toolName}`);
		if (command) {
			console.log(`${infoColor}Command:${resetColor} ${command}`);
		}
		if (sensitiveCheck.isSensitive && sensitiveCheck.matchedCommand) {
			console.log(
				`${warningColor}Reason:${resetColor} ${sensitiveCheck.matchedCommand.description}`,
			);
		}
		console.log('');
		console.log(`${successColor}[A]${resetColor} Approve`);
		console.log(`${errorColor}[R]${resetColor} Reject`);
		console.log('');

		// Ask for input
		rl.question(`${infoColor}Your choice:${resetColor} `, answer => {
			rl.close();

			const choice = answer.trim().toLowerCase();
			if (choice === 'r') {
				resolve('reject');
			} else {
				// Default to approve
				resolve('approve');
			}
		});
	});
}

export default function HeadlessModeScreen({prompt, onComplete}: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isComplete, setIsComplete] = useState(false);
	const [lastDisplayedIndex, setLastDisplayedIndex] = useState(-1);
	const [isWaitingForInput, setIsWaitingForInput] = useState(false);
	const {stdout} = useStdout();

	// Use custom hooks
	const streamingState = useStreamingState();
	const vscodeState = useVSCodeState();
	const {saveMessage} = useSessionSave();

	// Use tool confirmation hook
	const {isToolAutoApproved, addMultipleToAlwaysApproved} =
		useToolConfirmation();

	// Listen for message changes to display AI responses and tool calls
	useEffect(() => {
		const lastMessage = messages[messages.length - 1];
		const currentIndex = messages.length - 1;

		// Only display if this is a new message we haven't displayed yet
		if (!lastMessage || currentIndex <= lastDisplayedIndex) return;

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
				setLastDisplayedIndex(currentIndex);
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
				setLastDisplayedIndex(currentIndex);
			}
		}
	}, [messages, lastDisplayedIndex]);

	// Listen for streaming state to show loading status
	useEffect(() => {
		// Don't show thinking status when waiting for user input
		if (isWaitingForInput) return;

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
					: streamingState.streamTokenCount > 0
					? 'Writing...'
					: 'Thinking...';
				process.stdout.write(
					`\r\x1b[96m❆\x1b[90m ${thinkingText} \x1b[33m${streamingState.elapsedSeconds}s\x1b[37m · \x1b[32m↓ ${streamingState.streamTokenCount} tokens\x1b[0m`,
				);
			}
		}
	}, [
		streamingState.isStreaming,
		streamingState.isReasoning,
		streamingState.elapsedSeconds,
		streamingState.streamTokenCount,
		streamingState.retryStatus,
		isWaitingForInput,
	]);
	const processMessage = async () => {
		try {
			// Parse and validate file references
			const {cleanContent, validFiles} = await parseAndValidateFileReferences(
				prompt,
			);
			const regularFiles = validFiles.filter(f => !f.isImage);

			// Add user message to UI
			const userMessage: Message = {
				role: 'user',
				content: cleanContent,
				files: validFiles.length > 0 ? validFiles : undefined,
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

			console.log(`\x1b[36m└─ Assistant Response\x1b[0m`);

			// Create message for AI
			const messageForAI = createMessageWithFileInstructions(
				cleanContent,
				regularFiles,
				vscodeState.vscodeConnected ? vscodeState.editorContext : undefined,
			);

			// Start conversation with tool support
			await handleConversationWithTools({
				userContent: messageForAI,
				imageContents: [],
				controller,
				messages,
				saveMessage,
				setMessages,
				setStreamTokenCount: streamingState.setStreamTokenCount,
				requestToolConfirmation: async toolCall => {
					// In headless mode with YOLO, still need to confirm sensitive commands
					// Check if this is a sensitive command
					let needsConfirmation = false;

					if (toolCall.function.name === 'terminal-execute') {
						try {
							const args = JSON.parse(toolCall.function.arguments);
							const sensitiveCheck = isSensitiveCommand(args.command);
							needsConfirmation = sensitiveCheck.isSensitive;
						} catch {
							// If parsing fails, treat as normal command
						}
					}

					// If not sensitive, auto-approve (YOLO mode behavior)
					if (!needsConfirmation) {
						return 'approve';
					}

					// For sensitive commands, ask for confirmation
					// Clear thinking status before showing confirmation
					process.stdout.write('\r\x1b[K'); // Clear current line
					setIsWaitingForInput(true);

					const confirmation = await askHeadlessConfirmation(
						toolCall.function.name,
						toolCall.function.arguments,
					);

					setIsWaitingForInput(false);
					return confirmation;
				},
				requestUserQuestion: async () => {
					throw new Error('askuser tool is not supported in headless mode');
				},
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
