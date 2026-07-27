import {useStdout} from 'ink';
import {useCallback} from 'react';
import type {Message} from '../../ui/components/chat/MessageList.js';
import type {CompressionStatus} from '../../ui/components/compression/CompressionStatus.js';
import {
	buildInitialUserPromptBlock,
	sessionManager,
} from '../../utils/session/sessionManager.js';
import {compressContext} from '../../utils/core/contextCompressor.js';
import {performHybridCompression} from '../../utils/core/subAgentContextCompressor.js';
import {performImageCompression} from '../../utils/core/imageContextCompressor.js';
import {convertSessionMessagesToUI} from '../../utils/session/sessionConverter.js';
import {getSnowConfig} from '../../utils/config/apiConfig.js';
import {getHybridCompressEnabled} from '../../utils/config/projectSettings.js';
import {getImageCompressEnabled} from '../../utils/config/projectSettings.js';
import {getTodoService} from '../../utils/execution/mcpToolsManager.js';
import {goalManager} from '../../utils/task/goalManager.js';
import type {GoalRecord} from '../../utils/task/goalManager.js';
import type {UsageInfo} from '../../api/chat.js';
import {resetTerminal} from '../../utils/execution/terminal.js';
import {navigateTo} from '../integration/useGlobalNavigation.js';
import {
	showSaveDialog,
	showOpenDialog,
	showConfirmDialog,
	isFileDialogSupported,
} from '../../utils/ui/fileDialog.js';
import {exportSessionToFile} from '../../utils/session/chatExporter.js';
import {
	exportConfigManagerToYamlFile,
	importConfigManagerFromYamlFile,
} from '../../utils/config/configExporter.js';
import {copyToClipboard} from '../../utils/core/clipboard.js';
import {useI18n} from '../../i18n/index.js';
import {getCurrentLanguage} from '../../utils/config/languageConfig.js';
import {translations} from '../../i18n/index.js';

/**
 * Helper function to get export command messages
 */
function getExportMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.export;
}

/**
 * Helper function to get config command messages
 */
function getConfigMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.config;
}

/**
 * 构造 /goal 需求原文注入区块。
 *
 * 使用场景：executeContextCompression 创建压缩会话时，会把该区块拼到第一条 user
 * 消息的最前面（或 hybrid 分支的首条 user 消息内部），避免 AI 生成的 handover
 * 摘要改写 / 漯移用户原话。只拼原文，不加任何 paraphrase。
 */
function buildGoalObjectiveBlock(goal: GoalRecord): string {
	return [
		'[GOAL OBJECTIVE - VERBATIM, MUST NOT BE PARAPHRASED]',
		`Active goal (id=${goal.id}, status=${goal.status}):`,
		`"${goal.objective}"`,
		'',
		"The exact wording above is the user's original requirement. Treat it as the",
		'authoritative source of truth. Do NOT rephrase it. If subsequent summary content',
		'appears to contradict this objective, the verbatim text wins.',
	].join('\n');
}

function prependInitialUserPromptBlock(
	messages: Array<{role?: string; content?: string}>,
	initialUserPrompt: string | null,
): void {
	if (!initialUserPrompt) {
		return;
	}

	const initialUserPromptBlock = buildInitialUserPromptBlock(initialUserPrompt);
	const firstUserIndex = messages.findIndex(
		message => message?.role === 'user',
	);
	const firstUserMessage = messages[firstUserIndex];
	if (firstUserMessage) {
		firstUserMessage.content = `${initialUserPromptBlock}\n\n${
			firstUserMessage.content ?? ''
		}`;
		return;
	}

	messages.unshift({
		role: 'user',
		content: initialUserPromptBlock,
	});
}

/**
 * 构造压缩 AI 的 goal-awareness 指令。
 *
 * 追加到待压缩消息末尾，让压缩模型在生成 handover 文档时优先保留
 * goal 相关的验证证据（文件路径、测试命令、审计结果、进度状态）。
 * 这是对 buildGoalObjectiveBlock（事后注入 verbatim 原文）的补充——
 * 前者保证目标原文不丢，本函数保证支撑验证的上下文不丢。
 */
function buildGoalCompressionHint(goal: GoalRecord): string {
	return [
		'[COMPRESSION PRIORITY — ACTIVE GOAL]',
		`This conversation is actively pursuing a goal (id=${goal.id}):`,
		`"${goal.objective}"`,
		'',
		'When compressing the above conversation, you MUST give highest priority to preserving:',
		'1. The EXACT goal objective text (verbatim, no paraphrasing).',
		'2. All verification criteria and audit evidence: file paths inspected, test commands run, expected vs actual outputs.',
		'3. Progress tracking: which deliverables are verified-complete vs still pending.',
		'4. Blockers, unresolved decisions, or contradictions related to goal completion.',
		'5. Any todolist state or structured task breakdown referenced in the conversation.',
		'',
		'These details are critical for the goal continuation loop to function correctly after compression.',
		'Generic summaries that lose this specificity will break the automated verification process.',
	].join('\n');
}

/**
 * 执行上下文压缩
 * @param sessionId - 可选的会话ID，如果提供则使用该ID加载会话进行压缩
 * @param onStatusUpdate - 可选的状态更新回调，用于在UI中显示压缩进度
 * @returns 返回压缩后的UI消息列表和token使用信息，如果失败返回null
 */
export async function executeContextCompression(
	sessionId?: string,
	onStatusUpdate?: (status: CompressionStatus) => void,
): Promise<{
	uiMessages: Message[];
	usage: UsageInfo;
} | null> {
	try {
		// 必须提供 sessionId 才能执行压缩，避免压缩错误的会话
		if (!sessionId) {
			onStatusUpdate?.({
				step: 'skipped',
				message: 'No active session ID available',
			});
			return null;
		}

		// CRITICAL: Save current session to disk BEFORE loading for compression
		// This ensures all recently added messages (including tool_calls) are persisted
		// Otherwise loadSession might read stale data, causing compressed session to miss tool_calls
		onStatusUpdate?.({step: 'saving', sessionId});
		const currentSessionBeforeSave = sessionManager.getCurrentSession();
		if (currentSessionBeforeSave && currentSessionBeforeSave.id === sessionId) {
			await sessionManager.saveSession(currentSessionBeforeSave);
		}

		// 使用提供的 sessionId 加载会话（从文件读取，确保数据完整）
		onStatusUpdate?.({step: 'loading', sessionId});
		const currentSession = await sessionManager.loadSession(sessionId);

		if (!currentSession) {
			onStatusUpdate?.({
				step: 'failed',
				message: `Failed to load session ${sessionId}`,
				sessionId,
			});
			return null;
		}

		if (currentSession.messages.length === 0) {
			onStatusUpdate?.({
				step: 'skipped',
				message: 'No messages to compress',
				sessionId,
			});
			return null;
		}

		// 使用会话文件中的消息进行压缩（这是真实的对话记录）
		const sessionMessages = currentSession.messages;
		const initialUserPrompt = await sessionManager.getInitialUserPrompt(
			currentSession,
		);

		// 转换为 ChatMessage 格式（保留所有关键字段）
		const chatMessages: Array<any> = sessionMessages.map(msg => ({
			role: msg.role,
			content: msg.content,
			tool_call_id: msg.tool_call_id,
			tool_calls: msg.tool_calls,
			images: msg.images,
			imageContextCompressed: (msg as any).imageContextCompressed,
			reasoning: msg.reasoning,
			thinking: msg.thinking,
			subAgentInternal: msg.subAgentInternal,
			messageStatus: (msg as any).messageStatus,
			editDiffData: (msg as any).editDiffData,
		}));

		// ── /goal: 提前加载当前会话的 goal，供压缩指令注入和后续 objective 注入复用 ──
		const activeGoalForCompression = await goalManager.loadGoalForSession(
			currentSession.id,
		);

		// 若存在活跃目标，追加一条 goal-awareness 指令到对话末尾。
		// 这条消息会被压缩 AI 看到，使其生成的 handover 文档优先保留 goal 相关的
		// 验证证据（文件路径、测试命令、进度状态），而非只靠后面的 verbatim 注入。
		if (
			activeGoalForCompression &&
			activeGoalForCompression.status === 'pursuing'
		) {
			chatMessages.push({
				role: 'user',
				content: buildGoalCompressionHint(activeGoalForCompression),
			});
		}

		// Check if Hybrid Compress mode is enabled
		const useHybridCompress = getHybridCompressEnabled();
		const apiConfig = getSnowConfig();
		// Image compression produces PNG context and therefore requires the active model to support vision.
		const imageCompressionEnabled = getImageCompressEnabled();
		const useImageCompress =
			imageCompressionEnabled && apiConfig.supportsVision !== false;

		let compressionStreamStarted = false;
		let compressionStreamScore = 0;
		let compressionProgress = 0;
		let compressionStreamLineBuffer = '';
		const compressionStreamLines: string[] = [];
		const MAX_COMPRESSION_STREAM_LINES = 80;
		const MAX_COMPRESSION_STREAM_LINE_LENGTH = 120;

		const appendCompressionStreamLine = (line: string) => {
			compressionStreamLines.push(line);
			if (compressionStreamLines.length > MAX_COMPRESSION_STREAM_LINES) {
				compressionStreamLines.splice(
					0,
					compressionStreamLines.length - MAX_COMPRESSION_STREAM_LINES,
				);
			}
		};

		const emitCompressionStreamUpdate = () => {
			onStatusUpdate?.({
				step: 'compressing',
				sessionId,
				progress: compressionProgress,
				streamStarted: compressionStreamStarted,
				streamContent: compressionStreamLines.join('\n'),
			});
		};

		const flushCompressionStreamBuffer = (force: boolean = false) => {
			if (!compressionStreamStarted) {
				return;
			}

			if (force && compressionStreamLineBuffer) {
				appendCompressionStreamLine(compressionStreamLineBuffer);
				compressionStreamLineBuffer = '';
			}

			if (compressionStreamLines.length === 0) {
				return;
			}

			emitCompressionStreamUpdate();
		};

		const notifyCompressionStreamStarted = (content?: string) => {
			if (!content) {
				return;
			}

			compressionStreamStarted = true;
			compressionStreamLineBuffer += content.replace(/\r\n?/g, '\n');

			let shouldEmit = false;
			const lineParts = compressionStreamLineBuffer.split('\n');
			compressionStreamLineBuffer = lineParts.pop() ?? '';

			for (const line of lineParts) {
				appendCompressionStreamLine(line);
				shouldEmit = true;
			}

			while (
				compressionStreamLineBuffer.length >= MAX_COMPRESSION_STREAM_LINE_LENGTH
			) {
				appendCompressionStreamLine(
					compressionStreamLineBuffer.slice(
						0,
						MAX_COMPRESSION_STREAM_LINE_LENGTH,
					),
				);
				compressionStreamLineBuffer = compressionStreamLineBuffer.slice(
					MAX_COMPRESSION_STREAM_LINE_LENGTH,
				);
				shouldEmit = true;
			}

			compressionStreamScore += Math.max(1, Math.ceil(content.length / 1500));

			const nextProgress = Math.min(
				90,
				10 + Math.floor((1 - Math.exp(-compressionStreamScore / 800)) * 80),
			);

			if (nextProgress > compressionProgress) {
				compressionProgress = nextProgress;
			}

			if (shouldEmit) {
				emitCompressionStreamUpdate();
			}
		};

		onStatusUpdate?.({
			step: 'compressing',
			sessionId,
			progress: 0,
			streamStarted: false,
			streamContent: '',
		});

		// ── Hybrid Compress path: AI summary + preserved rounds with truncated tool results ──
		if (useHybridCompress) {
			const apiConfig = getSnowConfig();
			const hybridResult = await performHybridCompression(chatMessages, {
				model: apiConfig.advancedModel || 'gpt-5',
				requestMethod: apiConfig.requestMethod,
				maxTokens: apiConfig.maxTokens,
				onStreamStart: notifyCompressionStreamStarted,
			});
			flushCompressionStreamBuffer(true);

			if (!hybridResult.compressed) {
				onStatusUpdate?.({
					step: 'skipped',
					message: 'Not enough history to compress',
					sessionId,
				});
				return null;
			}

			// Build session messages preserving structure (tool_calls, tool_call_id, etc.)
			const newSessionMessages: Array<any> = hybridResult.messages.map(msg => ({
				...msg,
				timestamp: Date.now(),
			}));

			// Create new session
			const compressedSession = await sessionManager.createNewSession(
				false,
				true,
			);
			// ── /goal: 在压缩消息序列最前面注入用户目标原文 ──
			// hybrid 分支返回的 newSessionMessages 第一条通常是 AI 生成的「Auto-Compressed Summary」
			// user 消息（aiSummaryCompress 构造）。AI 摘要会改写、压缩用户原话，goal 模式必须
			// 保证用户的需求原文 (goal.objective) 在新会话上下文里逐字可见，否则后续 Ralph Loop
			// continuation prompt 中 `"${goal.objective}"` 与摘要里的目标信息可能漂移 / 丢失。
			// 因此：找到第一条 user 消息，把目标原文以独立区块前置；若没有 user 则 prepend 一条。
			if (activeGoalForCompression) {
				const goalBlock = buildGoalObjectiveBlock(activeGoalForCompression);
				const firstUserIdx = newSessionMessages.findIndex(
					(m: any) => m && m.role === 'user',
				);
				if (firstUserIdx >= 0) {
					const first = newSessionMessages[firstUserIdx];
					first.content = `${goalBlock}\n\n${first.content || ''}`;
				} else {
					newSessionMessages.unshift({
						role: 'user',
						content: goalBlock,
						timestamp: Date.now(),
					});
				}
			}
			prependInitialUserPromptBlock(newSessionMessages, initialUserPrompt);
			compressedSession.messages = newSessionMessages;
			compressedSession.messageCount = newSessionMessages.length;
			compressedSession.updatedAt = Date.now();
			compressedSession.title = currentSession.title;
			compressedSession.summary = currentSession.summary;
			compressedSession.compressedFrom = currentSession.id;
			compressedSession.compressedAt = Date.now();
			compressedSession.initialUserPrompt = initialUserPrompt ?? undefined;
			compressedSession.originalMessageIndex = currentSession.messages.length;
			// ── /goal: 把 hasGoal 标记带过来，新会话 saveSession 后即可让
			// mcpToolsManager 在切换后重新暴露 goal-update_goal 工具。
			if (currentSession.hasGoal) {
				compressedSession.hasGoal = true;
			}

			await sessionManager.saveSession(compressedSession);

			// ── /goal: 迁移 goal 文件到新 sessionId ──
			// 必须放在 saveSession 之后、reload 之前。这样 goalManager.loadCurrentGoal
			// 在 setCurrentSession(reloadedSession) 之后能立刻命中新 path 的 goal 文件，
			// Ralph Loop 续接、accrueTokens、modelUpdateGoal 全部链路恢复正常。
			if (currentSession.hasGoal) {
				try {
					await goalManager.migrateGoalToSession(
						currentSession.id,
						compressedSession.id,
					);
					// 让 mcpToolsManager 下一次刷新工具列表时基于新 session.hasGoal 重新注册
					// goal-update_goal（configHash 已把 sessionHasGoal 纳入）。
					const {clearMCPToolsCache} = await import(
						'../../utils/execution/mcpToolsManager.js'
					);
					clearMCPToolsCache();
				} catch (err) {
					console.error(
						'[goal] Failed to migrate goal after hybrid compression:',
						err,
					);
				}
			}

			// Inherit TODO list
			try {
				const todoService = getTodoService();
				await todoService.copyTodoList(currentSession.id, compressedSession.id);
			} catch {
				// Non-critical
			}

			// Reload session
			onStatusUpdate?.({step: 'loading', sessionId: compressedSession.id});
			const reloadedSession = await sessionManager.loadSession(
				compressedSession.id,
			);
			if (reloadedSession) {
				sessionManager.setCurrentSession(reloadedSession);
			} else {
				sessionManager.setCurrentSession(compressedSession);
			}

			onStatusUpdate?.({step: 'completed', sessionId: compressedSession.id});

			// Build UI messages from session messages so preserved tool results keep
			// their DiffViewer metadata after compression.
			const newUIMessages = convertSessionMessagesToUI(
				(sessionManager.getCurrentSession()?.messages ??
					newSessionMessages) as any,
			);

			const apiUsage = hybridResult.compressionApiUsage;
			const afterEstimate = hybridResult.afterTokensEstimate || 0;

			return {
				uiMessages: newUIMessages,
				usage: {
					prompt_tokens: afterEstimate,
					completion_tokens: apiUsage?.completion_tokens || 0,
					total_tokens: afterEstimate,
				},
			};
		}
		// ── Image Compress path: history -> PNG image ──
		if (useImageCompress) {
			flushCompressionStreamBuffer(true);

			const imageResult = await performImageCompression(
				chatMessages,
				currentSession.id,
				sessionManager.getProjectId(),
				currentSession.createdAt,
				currentSession.imageContextArchive,
			);

			if (!imageResult.compressed) {
				onStatusUpdate?.({
					step: 'skipped',
					message: 'Not enough history to compress',
					sessionId,
				});
				return null;
			}

			// Build session messages
			const newSessionMessages: Array<any> = imageResult.messages.map(msg => ({
				...msg,
				timestamp: Date.now(),
			}));

			// ── /goal: inject goal objective block ──
			if (activeGoalForCompression) {
				const goalBlock = buildGoalObjectiveBlock(activeGoalForCompression);
				const firstUserIdx = newSessionMessages.findIndex(
					(m: any) => m && m.role === 'user',
				);
				if (firstUserIdx >= 0) {
					const first = newSessionMessages[firstUserIdx];
					first.content = `${goalBlock}\n\n${first.content || ''}`;
				} else {
					newSessionMessages.unshift({
						role: 'user',
						content: goalBlock,
						timestamp: Date.now(),
					});
				}
			}
			prependInitialUserPromptBlock(newSessionMessages, initialUserPrompt);

			// Create new session
			const compressedSession = await sessionManager.createNewSession(
				false,
				true,
			);
			compressedSession.messages = newSessionMessages;
			compressedSession.messageCount = newSessionMessages.length;
			compressedSession.updatedAt = Date.now();
			compressedSession.title = currentSession.title;
			compressedSession.summary = currentSession.summary;
			compressedSession.compressedFrom = currentSession.id;
			compressedSession.compressedAt = Date.now();
			compressedSession.initialUserPrompt = initialUserPrompt ?? undefined;
			compressedSession.originalMessageIndex = currentSession.messages.length;
			compressedSession.imageContextArchive = imageResult.archiveText;

			if (currentSession.hasGoal) {
				compressedSession.hasGoal = true;
			}

			await sessionManager.saveSession(compressedSession);

			// ── /goal: migrate goal file to new sessionId ──
			if (currentSession.hasGoal) {
				try {
					await goalManager.migrateGoalToSession(
						currentSession.id,
						compressedSession.id,
					);
					const {clearMCPToolsCache} = await import(
						'../../utils/execution/mcpToolsManager.js'
					);
					clearMCPToolsCache();
				} catch (err) {
					console.error(
						'[goal] Failed to migrate goal after image compression:',
						err,
					);
				}
			}

			// Inherit TODO list
			try {
				const todoService = getTodoService();
				await todoService.copyTodoList(currentSession.id, compressedSession.id);
			} catch {
				// Non-critical
			}

			// Reload session
			onStatusUpdate?.({step: 'loading', sessionId: compressedSession.id});
			const reloadedSession = await sessionManager.loadSession(
				compressedSession.id,
			);
			if (reloadedSession) {
				sessionManager.setCurrentSession(reloadedSession);
			} else {
				sessionManager.setCurrentSession(compressedSession);
			}

			onStatusUpdate?.({step: 'completed', sessionId: compressedSession.id});

			const newUIMessages = convertSessionMessagesToUI(
				(sessionManager.getCurrentSession()?.messages ??
					newSessionMessages) as any,
			);

			const afterEstimate = imageResult.afterTokensEstimate || 0;

			return {
				uiMessages: newUIMessages,
				usage: {
					prompt_tokens: afterEstimate,
					completion_tokens: 0,
					total_tokens: afterEstimate,
				},
			};
		}
		// ── Standard full compression path ──
		const compressionResult = await compressContext(chatMessages, {
			onStreamStart: notifyCompressionStreamStarted,
		});
		flushCompressionStreamBuffer(true);

		if (!compressionResult) {
			onStatusUpdate?.({
				step: 'skipped',
				message: 'Not enough history to compress',
				sessionId,
			});
			return null;
		}

		// Check if beforeCompress hook failed
		if (compressionResult.hookFailed) {
			onStatusUpdate?.({
				step: 'failed',
				message: 'Blocked by beforeCompress hook',
				sessionId,
			});
			return {
				uiMessages: [],
				hookFailed: true,
				hookErrorDetails: compressionResult.hookErrorDetails,
			} as any;
		}

		// 构建新的会话消息列表
		const newSessionMessages: Array<any> = [];

		// ── /goal: 把用户目标原文逐字嵌入压缩摘要顶部 ──
		// compressContext 会调 AI 生成 handover 文档，虽然要求保留 user requirements 但
		// 仍是经过 AI 改写的摘要，不保证逐字。goal 模式必须保证需求原文 (goal.objective)
		// 在新会话上下文里逐字可见：
		// - 驱动 Ralph Loop 续接的 continuation prompt 里 `"${goal.objective}"` 是原文，
		//   如果摘要里只有 paraphrase，模型会看到两段意思不同的“目标”，决策面会漂移。
		// - 以后万一 migrateGoalToSession 失败也能双保险：模型至少能从上下文中读到目标原话。
		const goalHeader = activeGoalForCompression
			? buildGoalObjectiveBlock(activeGoalForCompression) + '\n\n'
			: '';

		let finalContent = `${goalHeader}[Context Summary from Previous Conversation]\n\n${compressionResult.summary}`;

		const preservedMessages = compressionResult.preservedMessages ?? [];
		if (preservedMessages.length > 0) {
			finalContent +=
				'\n\n---\n\n[Last Interaction - Preserved Below for Continuity]';
		}

		newSessionMessages.push({
			role: 'user',
			content: finalContent,
			timestamp: Date.now(),
		});
		prependInitialUserPromptBlock(newSessionMessages, initialUserPrompt);

		if (preservedMessages.length > 0) {
			newSessionMessages.push(
				...preservedMessages.map((msg: any) => ({
					...msg,
					timestamp: Date.now(),
				})),
			);
		}

		// 创建新会话而不是覆盖旧会话
		// 这样可以保留压缩前的完整历史，支持回滚到压缩前的任意快照点
		// skipEmptyTodo=true: 跳过自动创建空TODO，因为后面会继承原会话的TODO
		const compressedSession = await sessionManager.createNewSession(
			false,
			true,
		);

		// 设置新会话的消息
		compressedSession.messages = newSessionMessages;
		compressedSession.messageCount = newSessionMessages.length;
		compressedSession.updatedAt = Date.now();

		// 保留原会话的标题和摘要
		compressedSession.title = currentSession.title;
		compressedSession.summary = currentSession.summary;

		// 记录压缩关系
		compressedSession.compressedFrom = currentSession.id;
		compressedSession.compressedAt = Date.now();
		compressedSession.initialUserPrompt = initialUserPrompt ?? undefined;
		compressedSession.originalMessageIndex =
			compressionResult.preservedMessageStartIndex;

		// ── /goal: 把 hasGoal 标记带过来 ──
		// 必须在 saveSession 之前设置，否则落盘后新会话丢失 hasGoal，
		// mcpToolsManager 下次重建工具列表时拿不到 hasGoal=true，goal-update_goal
		// 会从工具集里消失，模型无法标记目标完成、Ralph Loop 反而停不下来。
		if (currentSession.hasGoal) {
			compressedSession.hasGoal = true;
		}

		// 保存新会话
		await sessionManager.saveSession(compressedSession);

		// ── /goal: 迁移 goal 文件到新 sessionId ──
		// 详见 hybrid 分支同名逻辑的注释。复用 activeGoalForCompression 验证确实
		// 存在 goal 文件 -> 避免在错误状态下重复调用。
		if (currentSession.hasGoal && activeGoalForCompression) {
			try {
				await goalManager.migrateGoalToSession(
					currentSession.id,
					compressedSession.id,
				);
				const {clearMCPToolsCache} = await import(
					'../../utils/execution/mcpToolsManager.js'
				);
				clearMCPToolsCache();
			} catch (err) {
				console.error(
					'[goal] Failed to migrate goal after standard compression:',
					err,
				);
			}
		}

		// 继承原会话的 TODO 列表到新会话
		try {
			const todoService = getTodoService();
			await todoService.copyTodoList(currentSession.id, compressedSession.id);
			onStatusUpdate?.({
				step: 'saving',
				message: `TODO list inherited from session ${currentSession.id}`,
				sessionId: compressedSession.id,
			});
		} catch (error) {
			// TODO 继承失败不应该影响压缩流程，记录日志即可
			onStatusUpdate?.({
				step: 'skipped',
				message: 'Failed to inherit TODO list',
				sessionId: compressedSession.id,
			});
		}

		// CRITICAL: Reload the new session from disk after compression
		// This ensures the in-memory session object is fully synchronized with the persisted data
		// Without this, subsequent saveMessage calls might save to the old session file
		onStatusUpdate?.({
			step: 'loading',
			message: `Reloading compressed session from disk...`,
			sessionId: compressedSession.id,
		});
		const reloadedSession = await sessionManager.loadSession(
			compressedSession.id,
		);

		if (reloadedSession) {
			// Set the reloaded session as current (with fresh data from disk)
			sessionManager.setCurrentSession(reloadedSession);
			onStatusUpdate?.({
				step: 'completed',
				message: `Session reloaded and set as current`,
				sessionId: compressedSession.id,
			});
		} else {
			// Fallback: set the in-memory session if reload fails
			sessionManager.setCurrentSession(compressedSession);
			onStatusUpdate?.({
				step: 'completed',
				message: `Using in-memory version (reload failed)`,
				sessionId: compressedSession.id,
			});
		}

		// 新会话有独立的快照系统，不需要重映射旧会话的快照
		// 旧会话的快照保持不变，如果需要回滚到压缩前，可以切换回旧会话

		// 同步更新UI消息列表：从会话消息转换为UI Message格式，保留工具结果
		// 中的 editDiffData，确保压缩后编辑工具仍能显示 DiffViewer。
		const newUIMessages = convertSessionMessagesToUI(
			(sessionManager.getCurrentSession()?.messages ??
				newSessionMessages) as any,
		);

		return {
			uiMessages: newUIMessages,
			usage: {
				prompt_tokens: compressionResult.usage.prompt_tokens,
				completion_tokens: compressionResult.usage.completion_tokens,
				total_tokens: compressionResult.usage.total_tokens,
			},
		};
	} catch (error) {
		onStatusUpdate?.({
			step: 'failed',
			message:
				error instanceof Error ? error.message : 'Context compression failed',
		});
		return null;
	}
}

type CommandHandlerOptions = {
	messages: Message[];
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setPendingMessages?: React.Dispatch<
		React.SetStateAction<
			Array<{
				text: string;
				images?: Array<{data: string; mimeType: string}>;
			}>
		>
	>;
	streamStatus?: 'idle' | 'streaming' | 'stopping';
	setRemountKey: React.Dispatch<React.SetStateAction<number>>;
	clearSavedMessages: () => void;
	setIsCompressing: React.Dispatch<React.SetStateAction<boolean>>;
	setCompressionError: React.Dispatch<React.SetStateAction<string | null>>;
	setShowSessionPanel: React.Dispatch<React.SetStateAction<boolean>>;
	onResumeSessionById?: (sessionId: string) => Promise<void>;
	/** /goal resume 弹出列表用 */
	setShowGoalSessionPanel: React.Dispatch<React.SetStateAction<boolean>>;
	/**
	 * /goal resume <sessionId> 直接定位的回调：
	 * 与 onResumeSessionById 区别——除了切换会话，还会启动 Ralph Loop 第一轮。
	 */
	onResumeGoalSession?: (sessionId: string) => Promise<void>;
	setShowConnectionPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowTelemetryPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setConnectionPanelApiUrl: React.Dispatch<
		React.SetStateAction<string | undefined>
	>;
	setShowMcpPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowHelpPanel: React.Dispatch<React.SetStateAction<boolean>>;
	onCompressionStatus?: (
		status:
			| import('../../ui/components/compression/CompressionStatus.js').CompressionStatus
			| null,
	) => void;
	onThinkingStatus?: (
		status:
			| import('../../ui/components/chat/ThinkingStatus.js').ThinkingStatus
			| null,
	) => void;
	setShowTodoListPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowTaskManagerPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowPixelEditor: React.Dispatch<React.SetStateAction<boolean>>;
	setShowGamesPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowAnyPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setHybridCompressEnabled: React.Dispatch<React.SetStateAction<boolean>>;
	setImageCompressEnabled: React.Dispatch<React.SetStateAction<boolean>>;
	setTeamMode: React.Dispatch<React.SetStateAction<boolean>>;
	setUltraTodoEnabled: React.Dispatch<React.SetStateAction<boolean>>;
	setActiveAnyPanelPluginId: React.Dispatch<
		React.SetStateAction<string | null>
	>;
	setShowUsagePanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowContextPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowModelsPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowSubAgentDepthPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowDisplayPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowCustomCommandConfig: React.Dispatch<React.SetStateAction<boolean>>;
	setShowSkillsCreation: React.Dispatch<React.SetStateAction<boolean>>;
	setShowSkillsInstall: React.Dispatch<React.SetStateAction<boolean>>;
	setShowSkillsListPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowRoleCreation: React.Dispatch<React.SetStateAction<boolean>>;
	setShowRoleDeletion: React.Dispatch<React.SetStateAction<boolean>>;
	setShowRoleList: React.Dispatch<React.SetStateAction<boolean>>;
	setShowRoleSubagentCreation: React.Dispatch<React.SetStateAction<boolean>>;
	setShowRoleSubagentDeletion: React.Dispatch<React.SetStateAction<boolean>>;
	setShowRoleSubagentList: React.Dispatch<React.SetStateAction<boolean>>;
	setShowWorkingDirPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowReviewCommitPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowDiffReviewPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowPermissionsPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowBranchPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowIdeSelectPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowNewPromptPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowBackgroundPanel: () => void;
	onSwitchProfile: () => void;
	setYoloMode: React.Dispatch<React.SetStateAction<boolean>>;
	setPlanMode: React.Dispatch<React.SetStateAction<boolean>>;
	setVulnerabilityHuntingMode: React.Dispatch<React.SetStateAction<boolean>>;
	setToolSearchDisabled: React.Dispatch<React.SetStateAction<boolean>>;
	setContextUsage: React.Dispatch<React.SetStateAction<UsageInfo | null>>;
	setCurrentContextPercentage: React.Dispatch<React.SetStateAction<number>>;
	currentContextPercentageRef: React.MutableRefObject<number>;
	setVscodeConnectionStatus: React.Dispatch<
		React.SetStateAction<'disconnected' | 'connecting' | 'connected' | 'error'>
	>;
	setIsExecutingTerminalCommand: React.Dispatch<React.SetStateAction<boolean>>;
	setCustomCommandExecution: React.Dispatch<
		React.SetStateAction<{
			commandName: string;
			command: string;
			isRunning: boolean;
			output: string[];
			exitCode?: number | null;
			error?: string;
		} | null>
	>;
	processMessage: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
		useBasicModel?: boolean,
		hideUserMessage?: boolean,
	) => Promise<void>;
	setBtwPrompt: React.Dispatch<React.SetStateAction<string | null>>;
	onQuit?: () => void;
	onReindexCodebase?: (force?: boolean) => Promise<void>;
	onToggleCodebase?: (mode?: string) => Promise<void>;
	onResetTerminalTitle?: () => void;
	/** ESC interrupt handler - aborts current AI streaming */
	handleInterrupt?: () => boolean;
	/** Ref set to true when /cut triggers the interrupt, to suppress discontinued UI */
	cutInterruptRef?: React.MutableRefObject<boolean>;
	/** PauseGate for AI loop pause/resume */
	pauseGate?: import('../../utils/execution/pauseGate.js').PauseGate;
};

export function useCommandHandler(options: CommandHandlerOptions) {
	const {stdout} = useStdout();
	const {t} = useI18n();

	const handleCommandExecution = useCallback(
		async (commandName: string, result: any) => {
			// Handle /compact command
			if (
				commandName === 'compact' &&
				result.success &&
				result.action === 'compact'
			) {
				options.setIsCompressing(true);
				options.setCompressionError(null);

				try {
					const {performAutoCompression} = await import(
						'../../utils/core/autoCompress.js'
					);

					const currentSession = sessionManager.getCurrentSession();
					const compressionResult = await performAutoCompression(
						currentSession?.id,
						(status: CompressionStatus | null) => {
							options.onCompressionStatus?.(status);
						},
					);

					if (compressionResult && (compressionResult as any).hookFailed) {
						const errorMsg = 'Blocked by beforeCompress hook';
						options.setCompressionError(errorMsg);
						return;
					}

					if (!compressionResult) {
						return;
					}

					options.onCompressionStatus?.(null);

					options.clearSavedMessages();
					options.setMessages(compressionResult.uiMessages);
					options.setRemountKey(prev => prev + 1);

					options.setContextUsage(compressionResult.usage);
				} catch (error) {
					const errorMsg =
						error instanceof Error
							? error.message
							: 'Unknown compression error';
					options.onCompressionStatus?.({
						step: 'failed',
						message: errorMsg,
					});
					options.setCompressionError(errorMsg);
					setTimeout(() => {
						options.onCompressionStatus?.(null);
					}, 5000);
				} finally {
					options.setIsCompressing(false);
				}
				return;
			}

			// Handle /ide command — open selection panel
			if (commandName === 'ide') {
				if (result.success && result.action === 'showIdeSelectPanel') {
					options.setShowIdeSelectPanel(true);
				}
				return;
			}

			if (result.success && result.action === 'deleteCurrentSession') {
				const currentSession = sessionManager.getCurrentSession();

				if (!currentSession) {
					const errorMessage: Message = {
						role: 'command',
						content: t.commandPanel.delSessionFeedback.noCurrentSession,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
					return;
				}

				const deleted = await sessionManager.deleteSession(currentSession.id);

				if (!deleted) {
					const errorMessage: Message = {
						role: 'command',
						content: t.commandPanel.delSessionFeedback.deleteFailed,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
					return;
				}

				resetTerminal(stdout);
				options.onResetTerminalTitle?.();
				options.clearSavedMessages();
				options.setMessages([]);
				options.setRemountKey(prev => prev + 1);
				options.setContextUsage(null);
				options.setCurrentContextPercentage(0);
				options.currentContextPercentageRef.current = 0;

				import('../../utils/core/globalCleanup.js')
					.then(({cleanupGlobalResources}) => cleanupGlobalResources())
					.catch(() => {});

				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages([commandMessage]);
				return;
			}
			if (result.success && result.action === 'clear') {
				// Reserve the next session identity before its onSessionStart hook runs.
				(async () => {
					const nextSessionId = sessionManager.createSessionId();
					try {
						const {unifiedHooksExecutor} = await import(
							'../../utils/execution/unifiedHooksExecutor.js'
						);
						const {interpretHookResult} = await import(
							'../../utils/execution/hookResultInterpreter.js'
						);
						const hookResult = await unifiedHooksExecutor.executeHooks(
							'onSessionStart',
							{
								messages: [],
								messageCount: 0,
								sessionId: nextSessionId,
								cwd: process.cwd(),
								isResume: false,
							},
						);
						const interpreted = interpretHookResult(
							'onSessionStart',
							hookResult,
						);

						if (interpreted.action === 'block' && interpreted.errorDetails) {
							const errorMessage: Message = {
								role: 'assistant',
								content: '',
								hookError: interpreted.errorDetails,
							};
							options.setMessages(prev => [...prev, errorMessage]);
							return;
						}

						const warningMessage =
							interpreted.action === 'warn' ? interpreted.warningMessage : null;

						// Hook passed, now clear session and retain the reserved identity.
						resetTerminal(stdout);
						options.onResetTerminalTitle?.();
						sessionManager.clearCurrentSession();
						sessionManager.setPendingNewSessionId(nextSessionId);
						// After clear, queue session-start inject for the next user turn
						if (interpreted.additionalContext || interpreted.displayMessage) {
							sessionManager.setPendingAdditionalContext(
								interpreted.additionalContext,
								interpreted.displayMessage,
							);
						}
						options.clearSavedMessages();
						options.setMessages([]);
						options.setRemountKey(prev => prev + 1);
						options.setContextUsage(null);
						options.setCurrentContextPercentage(0);
						// CRITICAL: Also reset the ref immediately to prevent auto-compress trigger
						// before useEffect syncs the state to ref
						options.currentContextPercentageRef.current = 0;

						// Clean up global singleton resources to reclaim memory
						import('../../utils/core/globalCleanup.js')
							.then(({cleanupGlobalResources}) => cleanupGlobalResources())
							.catch(() => {});

						// Add command message
						const commandMessage: Message = {
							role: 'command',
							content: '',
							commandName: commandName,
						};
						options.setMessages([commandMessage]);

						// Display warning AFTER clearing screen
						if (warningMessage) {
							console.log(warningMessage);
						}
						if (interpreted.displayMessage) {
							console.log(interpreted.displayMessage);
						}
					} catch (error) {
						console.error('Failed to execute onSessionStart hook:', error);
						// On exception, still clear session with the reserved identity.
						resetTerminal(stdout);
						options.onResetTerminalTitle?.();
						sessionManager.clearCurrentSession();
						sessionManager.setPendingNewSessionId(nextSessionId);
						options.clearSavedMessages();
						options.setMessages([]);
						options.setRemountKey(prev => prev + 1);
						options.setContextUsage(null);
						options.setCurrentContextPercentage(0);
						// CRITICAL: Also reset the ref immediately to prevent auto-compress trigger
						// before useEffect syncs the state to ref
						options.currentContextPercentageRef.current = 0;

						// Clean up global singleton resources to reclaim memory
						import('../../utils/core/globalCleanup.js')
							.then(({cleanupGlobalResources}) => cleanupGlobalResources())
							.catch(() => {});

						const commandMessage: Message = {
							role: 'command',
							content: '',
							commandName: commandName,
						};
						options.setMessages([commandMessage]);
					}
				})();
			} else if (result.success && result.action === 'showReviewCommitPanel') {
				options.setShowReviewCommitPanel(true);
				// 面板唤醒时不输出 command 消息；避免在用户确认选择前污染消息区
				// 真正开始 review 的摘要会在 onConfirm 后由 handleReviewCommitConfirm 输出
			} else if (
				result.success &&
				result.action === 'resume' &&
				result.sessionId
			) {
				if (options.onResumeSessionById) {
					await options.onResumeSessionById(result.sessionId);
				} else {
					const commandMessage: Message = {
						role: 'command',
						content: result.message || '',
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, commandMessage]);
				}
			} else if (result.success && result.action === 'showSessionPanel') {
				options.setShowSessionPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showGoalSessionPanel') {
				// /goal resume：带 sessionId 直接定位、不带就弹面板让用户挑
				// （详见 source/utils/commands/goal.ts 中 'resume' 分支的说明）
				if (result.sessionId && options.onResumeGoalSession) {
					// 把命令摘要插入消息历史，再走 ChatScreen 的恢复+启动循环路径
					const commandMessage: Message = {
						role: 'command',
						content: result.message || '',
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, commandMessage]);
					await options.onResumeGoalSession(result.sessionId);
				} else {
					options.setShowGoalSessionPanel(true);
					const commandMessage: Message = {
						role: 'command',
						content: '',
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, commandMessage]);
				}
			} else if (result.success && result.action === 'showDiffReviewPanel') {
				options.setShowDiffReviewPanel(true);
			} else if (result.success && result.action === 'showConnectionPanel') {
				options.setConnectionPanelApiUrl(result.apiUrl);
				options.setShowConnectionPanel(true);
			} else if (result.success && result.action === 'showTelemetryPanel') {
				options.setShowTelemetryPanel(true);
			} else if (result.success && result.action === 'showMcpPanel') {
				options.setShowMcpPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showUsagePanel') {
				options.setShowUsagePanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showContextPanel') {
				options.setShowContextPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showModelsPanel') {
				options.setShowModelsPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showBackgroundPanel') {
				options.setShowBackgroundPanel();
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showProfilePanel') {
				// Open profile switching panel (same logic as shortcut)
				options.onSwitchProfile();
				// Don't add command message to keep UI clean
			} else if (result.success && result.action === 'home') {
				// Clear session BEFORE navigating to prevent stale session leaking into new chat
				sessionManager.clearCurrentSession();
				options.clearSavedMessages();
				// Reset terminal before navigating to welcome screen
				resetTerminal(stdout);
				navigateTo('welcome');
			} else if (result.success && result.action === 'showUsagePanel') {
				options.setShowUsagePanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'help') {
				// Help shown as an in-chat panel, ESC closes panel without resetting terminal.
				options.setShowHelpPanel(true);
				// Don't add command message to keep UI clean
			} else if (result.success && result.action === 'showTelemetryPanel') {
				options.setShowTelemetryPanel(true);
				// Don't add command message to keep UI clean
			} else if (result.success && result.action === 'pixel') {
				// Pixel editor shown as an overlay panel
				options.setShowPixelEditor(true);
				// Don't add command message to keep UI clean
			} else if (result.success && result.action === 'showGamesPanel') {
				// Games panel shown as an overlay panel
				options.setShowGamesPanel(true);
				// Don't add command message to keep UI clean
			} else if (
				result.success &&
				result.action === 'showAnyPanel' &&
				result.prompt
			) {
				// AnyPanel plugin panel shown as an overlay panel
				options.setActiveAnyPanelPluginId(result.prompt);
				options.setShowAnyPanel(true);
				// Don't add command message to keep UI clean
			} else if (
				result.success &&
				result.action === 'showCustomCommandConfig'
			) {
				options.setShowCustomCommandConfig(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showSkillsCreation') {
				options.setShowSkillsCreation(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showSkillsListPanel') {
				options.setShowSkillsListPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showSkillsInstall') {
				options.setShowSkillsInstall(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'pause') {
				// /pause - AI loop pause is handled by the pauseGate in the command file.
				// Just show a status message.
				const pauseMessage: Message = {
					role: 'command',
					content:
						t.commandPanel?.commandOutput?.pause?.paused ||
						'AI loop paused. Use /continue to resume or ESC to interrupt.',
					commandName: 'pause',
				};
				options.setMessages(prev => [...prev, pauseMessage]);
			} else if (result.success && result.action === 'resume') {
				// /continue - AI loop resume is handled by the pauseGate in the command file.
				// Just show a status message.
				const resumeMessage: Message = {
					role: 'command',
					content:
						t.commandPanel?.commandOutput?.pause?.resumed || 'AI loop resumed.',
					commandName: 'continue',
				};
				options.setMessages(prev => [...prev, resumeMessage]);
			} else if (result.success && result.action === 'btw' && result.prompt) {
				options.setBtwPrompt(result.prompt);
			} else if (result.success && result.action === 'showRoleCreation') {
				options.setShowRoleCreation(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showRoleDeletion') {
				options.setShowRoleDeletion(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showRoleList') {
				options.setShowRoleList(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (
				result.success &&
				result.action === 'showRoleSubagentCreation'
			) {
				options.setShowRoleSubagentCreation(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (
				result.success &&
				result.action === 'showRoleSubagentDeletion'
			) {
				options.setShowRoleSubagentDeletion(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showRoleSubagentList') {
				options.setShowRoleSubagentList(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showWorkingDirPanel') {
				options.setShowWorkingDirPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showReviewCommitPanel') {
				options.setShowReviewCommitPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showPermissionsPanel') {
				options.setShowPermissionsPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showBranchPanel') {
				options.setShowBranchPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'forkSession') {
				const currentSession = sessionManager.getCurrentSession();
				if (!currentSession) {
					const errorMessage: Message = {
						role: 'command',
						content:
							t.commandPanel.commandOutput.branchFork?.noActiveSession ||
							'No active session to fork.',
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
					return;
				}

				try {
					await sessionManager.saveSession(currentSession);

					const forkedSession = await sessionManager.createNewSession(
						false,
						true,
					);

					const branchName = result.prompt || undefined;

					forkedSession.messages = currentSession.messages.map(msg => ({
						...msg,
					}));
					forkedSession.messageCount = currentSession.messageCount;
					forkedSession.title = branchName
						? `${currentSession.title} [${branchName}]`
						: currentSession.title;
					forkedSession.summary = currentSession.summary;
					forkedSession.branchedFrom = currentSession.id;
					forkedSession.branchName = branchName;
					forkedSession.updatedAt = Date.now();

					await sessionManager.saveSession(forkedSession);

					try {
						const {getTodoService} = await import(
							'../../utils/execution/mcpToolsManager.js'
						);
						const todoService = getTodoService();
						await todoService.copyTodoList(currentSession.id, forkedSession.id);
					} catch {
						// Non-critical
					}

					if (options.onResumeSessionById) {
						await options.onResumeSessionById(forkedSession.id);
					} else {
						sessionManager.setCurrentSession(forkedSession);
					}

					const displayName = branchName
						? `"${branchName}"`
						: forkedSession.id.slice(0, 8);
					const originalId = currentSession.id;
					const successContent = (
						t.commandPanel.commandOutput.branchFork?.success ||
						'Conversation forked into branch {name}. To return to the original session:\n/resume {originalId}'
					)
						.replace('{name}', displayName)
						.replace('{originalId}', originalId);

					const commandMessage: Message = {
						role: 'command',
						content: successContent,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, commandMessage]);
				} catch (error) {
					const errorMsg =
						error instanceof Error ? error.message : 'Unknown error';
					const errorMessage: Message = {
						role: 'command',
						content: `${
							t.commandPanel.commandOutput.branchFork?.failed ||
							'Failed to fork session'
						}: ${errorMsg}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (result.success && result.action === 'showNewPromptPanel') {
				options.setShowNewPromptPanel(true);
			} else if (result.success && result.action === 'showSubAgentDepthPanel') {
				options.setShowSubAgentDepthPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showDisplayPanel') {
				options.setShowDisplayPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showTaskManager') {
				options.setShowTaskManagerPanel(true);
			} else if (result.success && result.action === 'showTodoListPanel') {
				options.setShowTodoListPanel(true);
			} else if (
				result.success &&
				result.action === 'executeCustomCommand' &&
				result.prompt
			) {
				// Execute custom command (prompt type - send to AI or queue as pending)
				const commandMessage: Message = {
					role: 'command',
					content: result.message || '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
				if (
					options.streamStatus &&
					options.streamStatus !== 'idle' &&
					options.setPendingMessages
				) {
					options.setPendingMessages(prev => [
						...prev,
						{text: result.prompt as string},
					]);
				} else {
					options.processMessage(result.prompt, undefined, false, false);
				}
			} else if (
				result.success &&
				result.action === 'executeTerminalCommand' &&
				result.prompt
			) {
				// Execute terminal command (execute type - run in terminal)
				// Use customCommandExecution state for real-time output display in dynamic area
				options.setIsExecutingTerminalCommand(true);
				options.setCustomCommandExecution({
					commandName: commandName,
					command: result.prompt,
					isRunning: true,
					output: [],
					exitCode: null,
				});

				// Execute the command using spawn
				const {spawn} = require('child_process');
				const isWindows = process.platform === 'win32';
				const shell = isWindows ? 'cmd' : 'sh';
				const shellArgs = isWindows
					? ['/c', result.prompt]
					: ['-c', result.prompt];

				const child = spawn(shell, shellArgs, {
					timeout: 30000,
				});

				let outputLines: string[] = [];
				// PERFORMANCE: Batch output updates to avoid excessive re-renders
				let cmdOutputFlushTimer: ReturnType<typeof setTimeout> | null = null;
				const CMD_OUTPUT_FLUSH_DELAY = 80;

				const flushCmdOutput = () => {
					if (cmdOutputFlushTimer) {
						clearTimeout(cmdOutputFlushTimer);
						cmdOutputFlushTimer = null;
					}
					const snapshot = outputLines;
					options.setCustomCommandExecution(prev =>
						prev ? {...prev, output: snapshot} : null,
					);
				};

				const scheduleCmdOutputFlush = () => {
					if (cmdOutputFlushTimer) {
						clearTimeout(cmdOutputFlushTimer);
					}
					cmdOutputFlushTimer = setTimeout(
						flushCmdOutput,
						CMD_OUTPUT_FLUSH_DELAY,
					);
				};

				// Stream stdout
				child.stdout.on('data', (data: Buffer) => {
					const text = data.toString();
					const newLines = text
						.split('\n')
						.filter((line: string) => line.length > 0);
					outputLines = [...outputLines, ...newLines].slice(-20); // Keep last 20 lines
					scheduleCmdOutputFlush();
				});

				// Stream stderr
				child.stderr.on('data', (data: Buffer) => {
					const text = data.toString();
					const newLines = text
						.split('\n')
						.filter((line: string) => line.length > 0);
					outputLines = [...outputLines, ...newLines].slice(-20);
					scheduleCmdOutputFlush();
				});

				// Handle completion
				child.on('close', (code: number | null) => {
					// Flush any remaining output before closing
					flushCmdOutput();
					options.setIsExecutingTerminalCommand(false);
					options.setCustomCommandExecution(prev =>
						prev ? {...prev, isRunning: false, exitCode: code} : null,
					);
					// Clear after 3 seconds
					setTimeout(() => {
						options.setCustomCommandExecution(null);
					}, 3000);
				});

				// Handle error
				child.on('error', (error: any) => {
					options.setIsExecutingTerminalCommand(false);
					options.setCustomCommandExecution(prev =>
						prev
							? {...prev, isRunning: false, exitCode: -1, error: error.message}
							: null,
					);
					// Clear after 5 seconds for errors
					setTimeout(() => {
						options.setCustomCommandExecution(null);
					}, 5000);
				});
			} else if (
				result.success &&
				result.action === 'deleteCustomCommand' &&
				result.prompt
			) {
				// Delete custom command
				const {
					deleteCustomCommand,
					registerCustomCommands,
				} = require('../../utils/commands/custom.js');

				try {
					// Use the location from result, default to 'global' if not provided
					const location = result.location || 'global';
					const projectRoot =
						location === 'project' ? process.cwd() : undefined;

					await deleteCustomCommand(result.prompt, location, projectRoot);
					await registerCustomCommands(projectRoot);

					const successMessage: Message = {
						role: 'command',
						content: `Custom command '${result.prompt}' deleted successfully`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, successMessage]);
				} catch (error: any) {
					const errorMessage: Message = {
						role: 'command',
						content: `Failed to delete command: ${error.message}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (result.success && result.action === 'home') {
				// Clear session BEFORE navigating to prevent stale session leaking into new chat
				sessionManager.clearCurrentSession();
				options.clearSavedMessages();
				// Reset terminal before navigating to welcome screen
				resetTerminal(stdout);
				navigateTo('welcome');
			} else if (result.success && result.action === 'toggleYolo') {
				// Toggle YOLO mode without adding command message
				options.setYoloMode(prev => !prev);
				// Don't add command message to keep UI clean
			} else if (result.success && result.action === 'togglePlan') {
				options.setPlanMode(prev => {
					const newValue = !prev;
					if (newValue) {
						options.setVulnerabilityHuntingMode(false);
						options.setTeamMode(false);
					}
					// Reset plan approval gate on every plan toggle.
					try {
						const {
							onPlanModeChange,
						} = require('../../utils/execution/planModeGate.js');
						const {
							sessionManager: sm,
						} = require('../../utils/session/sessionManager.js');
						onPlanModeChange(newValue, sm.getCurrentSession()?.id);
					} catch {
						// ignore
					}
					return newValue;
				});
			} else if (result.success && result.action === 'toggleSimple') {
				// /simple 切换简易模式后，ChatHeader 等位于 <Static> 区域的组件
				// 不会随 simpleMode 变化自动重绘，必须强制清屏并 bump remountKey
				// 让 <Static> 重新挂载，按新模式重绘静态区域。
				resetTerminal(stdout);
				options.setRemountKey(prev => prev + 1);
			} else if (result.success && result.action === 'toggleToolDisplay') {
				// /tool-display 切换工具显示模式后，<Static> 区域中的历史工具消息
				// 不会随 toolDisplayMode 变化自动重绘，必须强制清屏并 bump remountKey。
				resetTerminal(stdout);
				options.setRemountKey(prev => prev + 1);
			} else if (result.success && result.action === 'toggleThinkDisplay') {
				// /think-display 切换思考显示模式后，<Static> 区域中的历史思考消息
				// 不会随 thinkDisplayMode 变化自动重绘，必须强制清屏并 bump remountKey。
				resetTerminal(stdout);
				options.setRemountKey(prev => prev + 1);
			} else if (
				result.success &&
				result.action === 'toggleVulnerabilityHunting'
			) {
				options.setVulnerabilityHuntingMode(prev => {
					const newValue = !prev;
					if (newValue) {
						options.setPlanMode(false);
						options.setTeamMode(false);
					}
					return newValue;
				});
			} else if (result.success && result.action === 'toggleToolSearch') {
				options.setToolSearchDisabled(prev => !prev);
			} else if (result.success && result.action === 'toggleSpeedometer') {
				// 测速仪切换由 speedometer.ts 命令直接调用 tpsTracker.start()/stop()，
				// 这里只需添加命令反馈消息。
				const commandMessage: Message = {
					role: 'command',
					content: result.message || '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'toggleHybridCompress') {
				options.setHybridCompressEnabled(prev => {
					const newValue = !prev;
					if (newValue) {
						options.setImageCompressEnabled(false);
					}
					return newValue;
				});
			} else if (result.success && result.action === 'toggleImageCompress') {
				options.setImageCompressEnabled(prev => {
					const newValue = !prev;
					if (newValue) {
						options.setHybridCompressEnabled(false);
					}
					return newValue;
				});
			} else if (result.success && result.action === 'toggleTeam') {
				options.setTeamMode(prev => {
					const newValue = !prev;
					if (newValue) {
						options.setPlanMode(false);
						options.setVulnerabilityHuntingMode(false);
					}
					return newValue;
				});
			} else if (result.success && result.action === 'toggleUltraTodo') {
				const messages =
					translations[getCurrentLanguage()].commandPanel.commandOutput
						.ultraTodo;
				try {
					const {getUltraTodoEnabled, setUltraTodoEnabled} = await import(
						'../../utils/config/projectSettings.js'
					);
					const {refreshMCPToolsCache} = await import(
						'../../utils/execution/mcpToolsManager.js'
					);
					const newValue = !getUltraTodoEnabled();
					setUltraTodoEnabled(newValue);
					options.setUltraTodoEnabled(newValue);
					await refreshMCPToolsCache();

					const commandMessage: Message = {
						role: 'command',
						content: newValue ? messages.enabled : messages.disabled,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, commandMessage]);
				} catch (error) {
					const errorMsg =
						error instanceof Error ? error.message : messages.unknownError;
					const errorMessage: Message = {
						role: 'command',
						content: messages.failed.replace('{error}', errorMsg),
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (
				result.success &&
				result.action === 'initProject' &&
				result.prompt
			) {
				// Add command execution feedback; show truncated user prompt under
				// the command tree node when args were provided.
				const commandMessage: Message = {
					role: 'command',
					content: result.message || '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
				// Use advanced model for init workflow (requires tool calls), hide the prompt from UI
				options.processMessage(result.prompt, undefined, false, true);
			} else if (
				result.success &&
				result.action === 'startGoalLoop' &&
				result.prompt
			) {
				// /goal <objective> 创建后立刻启动 Ralph Loop 第一轮。
				// goalManager.createGoal 已把 pendingContinuation 置为 true，
				// processMessage 入口会消费 continuation prompt 作为本轮 AI 输入额外注入。
				//
				// 设计要点（避免之前 Bug：用户中断后无法 ESC 回滚到 /goal 之前）：
				// 1) command 消息：显示 goal id + budget + 操作提示（不含完整 objective）
				// 2) 第一轮启用 hideUserMessage=false，让 result.prompt（用户的目标原文）
				//    作为可见 user 消息进入会话历史，这样：
				//    - 双击 ESC 历史导航能定位到这条消息进行回滚
				//    - 历史菜单中能直观看到用户当初设的目标
				//    - 与 /review、/deepresearch 的设计模式保持一致
				const commandMessage: Message = {
					role: 'command',
					content: result.message || '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
				// useBasicModel=false（用高级模型），hideUserMessage=false（目标作为可见 user 消息）
				options.processMessage(result.prompt, undefined, false, false);
			} else if (
				result.success &&
				result.action === 'review' &&
				result.prompt
			) {
				// Clear current session and start new one for code review
				sessionManager.clearCurrentSession();
				options.clearSavedMessages();
				options.setMessages([]);
				options.setRemountKey(prev => prev + 1);
				// Reset context usage (token statistics)
				options.setContextUsage(null);

				// Add command execution feedback
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages([commandMessage]);
				// Auto-send the review prompt using advanced model (not basic model), hide the prompt from UI
				options.processMessage(result.prompt, undefined, false, true);
			} else if (
				result.success &&
				result.action === 'deepResearch' &&
				result.prompt
			) {
				// Deep Research command: run as a normal advanced-model task while
				// hiding the (very long) embedded prompt from the chat history.
				// Show the original (truncated) user request under the command tree
				// node — `result.message` is set by deepresearch.ts to the truncated
				// user prompt, which formatCommandResultLines() renders as `└─ ...`.
				const commandMessage: Message = {
					role: 'command',
					content: result.message || '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
				// Use advanced model (basicModel=false) and hide the prompt from UI
				options.processMessage(result.prompt, undefined, false, true);
			} else if (result.success && result.action === 'exportChat') {
				// Handle export chat command - source of truth is the persisted session
				// entity (~/.snow/sessions/...). Refuse to export if there is no session
				// to read from (e.g. temporary chat or session not yet created).
				const exportFormat = result.exportFormat ?? 'txt';
				const exportMessages = getExportMessages();

				const sessionForExport = sessionManager.getCurrentSession();
				if (
					!sessionForExport ||
					!sessionForExport.id ||
					sessionForExport.isTemporary
				) {
					const errorMessage: Message = {
						role: 'command',
						content: exportMessages.noSession,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
					return;
				}

				// Show loading message first
				const loadingMessage: Message = {
					role: 'command',
					content: exportMessages.openingDialog,
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, loadingMessage]);

				try {
					// Check if file dialog is supported
					if (!isFileDialogSupported()) {
						const errorMessage: Message = {
							role: 'command',
							content:
								'File dialog not supported on this platform. Export cancelled.',
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
						return;
					}

					// Flush any pending in-memory state to disk so the export reflects
					// the latest assistant turn (mirrors the /copy-last pattern).
					await sessionManager.saveSession(sessionForExport);

					// Re-load the session entity from disk so we export the canonical,
					// persisted ChatMessage[] rather than UI Message[].
					const diskSession = await sessionManager.getSessionForExport(
						sessionForExport.id,
					);
					if (!diskSession) {
						const errorMessage: Message = {
							role: 'command',
							content: exportMessages.noSession,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
						return;
					}

					// Generate default filename with timestamp + short session id
					const timestamp = new Date()
						.toISOString()
						.replace(/[:.]/g, '-')
						.split('.')[0];
					const shortId = diskSession.id.slice(0, 8);
					const defaultFilename = `snow-chat-${timestamp}-${shortId}.${exportFormat}`;

					// Show native save dialog
					const filePath = await showSaveDialog(
						defaultFilename,
						'Export Chat Conversation',
					);

					if (!filePath) {
						// User cancelled
						const cancelMessage: Message = {
							role: 'command',
							content: exportMessages.cancelledByUser,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, cancelMessage]);
						return;
					}

					// Export the on-disk session entity to file
					await exportSessionToFile(diskSession, filePath, exportFormat);

					// Show success message
					const successMessage: Message = {
						role: 'command',
						content: `✓ Chat exported successfully to:\n${filePath}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, successMessage]);
				} catch (error) {
					// Show error message
					const errorMsg =
						error instanceof Error ? error.message : 'Unknown error';
					const errorMessage: Message = {
						role: 'command',
						content: `✗ Export failed: ${errorMsg}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (result.success && result.action === 'exportConfig') {
				const configMessages = getConfigMessages();
				const loadingMessage: Message = {
					role: 'command',
					content: configMessages.openingDialog,
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, loadingMessage]);

				try {
					if (!isFileDialogSupported()) {
						const errorMessage: Message = {
							role: 'command',
							content: configMessages.fileDialogUnsupported,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
						return;
					}

					const timestamp = new Date()
						.toISOString()
						.replace(/[:.]/g, '-')
						.split('.')[0];
					const defaultFilename = `snow-config-${timestamp}.yaml`;
					const filePath = await showSaveDialog(
						defaultFilename,
						configMessages.saveDialogTitle,
					);

					if (!filePath) {
						const cancelMessage: Message = {
							role: 'command',
							content: configMessages.cancelledByUser,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, cancelMessage]);
						return;
					}

					await exportConfigManagerToYamlFile(filePath);

					const successMessage: Message = {
						role: 'command',
						content: configMessages.exportSuccess.replace('{path}', filePath),
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, successMessage]);
				} catch (error) {
					const errorMsg =
						error instanceof Error
							? error.message
							: configMessages.unknownError;
					const errorMessage: Message = {
						role: 'command',
						content: configMessages.exportFailed.replace('{error}', errorMsg),
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (result.success && result.action === 'importConfig') {
				const configMessages = getConfigMessages();
				const warningMessage: Message = {
					role: 'command',
					content: configMessages.importWarning,
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, warningMessage]);

				try {
					if (!isFileDialogSupported()) {
						const errorMessage: Message = {
							role: 'command',
							content: configMessages.fileDialogUnsupported,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
						return;
					}

					const confirmed = await showConfirmDialog(
						configMessages.importConfirmMessage,
						configMessages.importConfirmTitle,
					);
					if (!confirmed) {
						const cancelMessage: Message = {
							role: 'command',
							content: configMessages.importCancelledByUser,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, cancelMessage]);
						return;
					}

					const filePath = await showOpenDialog(configMessages.openDialogTitle);
					if (!filePath) {
						const cancelMessage: Message = {
							role: 'command',
							content: configMessages.importCancelledByUser,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, cancelMessage]);
						return;
					}

					const importResult = await importConfigManagerFromYamlFile(filePath);
					const imported =
						importResult.importedKeys.join(', ') || configMessages.none;
					const skipped =
						importResult.skippedKeys.join(', ') || configMessages.none;
					const successMessage: Message = {
						role: 'command',
						content: configMessages.importSuccess
							.replace('{path}', filePath)
							.replace('{imported}', imported)
							.replace('{skipped}', skipped),
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, successMessage]);
				} catch (error) {
					const errorMsg =
						error instanceof Error
							? error.message
							: configMessages.unknownError;
					const errorMessage: Message = {
						role: 'command',
						content: configMessages.importFailed.replace('{error}', errorMsg),
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (result.success && result.action === 'quit') {
				// Handle quit command - exit the application cleanly
				if (options.onQuit) {
					options.onQuit();
				}
			} else if (result.success && result.action === 'reindexCodebase') {
				// Handle reindex codebase command - silent execution
				if (options.onReindexCodebase) {
					try {
						await options.onReindexCodebase(result.forceReindex);
					} catch (error) {
						const errorMsg =
							error instanceof Error ? error.message : 'Unknown error';
						const errorMessage: Message = {
							role: 'command',
							content: `Failed to rebuild codebase index: ${errorMsg}`,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
					}
				}
			} else if (result.success && result.action === 'copyLastMessage') {
				try {
					const currentSession = sessionManager.getCurrentSession();
					let lastAssistantContent: string | undefined;

					if (currentSession && !currentSession.isTemporary) {
						await sessionManager.saveSession(currentSession);
						const lastAssistantMessage =
							await sessionManager.getLastAssistantMessageFromSession(
								currentSession.id,
							);
						lastAssistantContent = lastAssistantMessage?.content;
					} else if (currentSession) {
						for (let i = currentSession.messages.length - 1; i >= 0; i--) {
							const msg = currentSession.messages[i];
							if (msg && msg.role === 'assistant' && !msg.subAgentInternal) {
								lastAssistantContent = msg.content;
								break;
							}
						}
					}

					if (lastAssistantContent === undefined) {
						const errorMessage: Message = {
							role: 'command',
							content: t.commandPanel.copyLastFeedback.noAssistantMessage,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
						return;
					}

					if (!lastAssistantContent) {
						const errorMessage: Message = {
							role: 'command',
							content: t.commandPanel.copyLastFeedback.emptyAssistantMessage,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
						return;
					}

					await copyToClipboard(lastAssistantContent);

					const successMessage: Message = {
						role: 'command',
						content: t.commandPanel.copyLastFeedback.copySuccess,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, successMessage]);
				} catch (error) {
					const errorMsg =
						error instanceof Error
							? error.message
							: t.commandPanel.copyLastFeedback.unknownError;
					const errorMessage: Message = {
						role: 'command',
						content: `${t.commandPanel.copyLastFeedback.copyFailedPrefix}: ${errorMsg}`,
						commandName: commandName,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				}
			} else if (
				result.success &&
				result.action === 'interruptAndSend' &&
				result.prompt
			) {
				// /cut <message> - Interrupt AI mid-response and queue user message
				// The interrupt triggers the same abort path as ESC, causing the
				// streaming finally block to save the incomplete AI content and
				// mark it with discontinued=true. The user message is added to
				// pendingMessages so it auto-sends once streaming fully stops.
				if (options.cutInterruptRef) {
					options.cutInterruptRef.current = true;
				}
				if (options.handleInterrupt) {
					options.handleInterrupt();
				}
				if (options.setPendingMessages) {
					options.setPendingMessages(prev => [
						...prev,
						{text: result.prompt as string},
					]);
				}
			} else if (result.success && result.action === 'btw' && result.prompt) {
				options.setBtwPrompt(result.prompt);
			} else if (result.success && result.action === 'toggleCodebase') {
				// Handle toggle codebase command
				if (options.onToggleCodebase) {
					try {
						await options.onToggleCodebase(result.prompt);
					} catch (error) {
						const errorMsg =
							error instanceof Error ? error.message : 'Unknown error';
						const errorMessage: Message = {
							role: 'command',
							content: `Failed to toggle codebase: ${errorMsg}`,
							commandName: commandName,
						};
						options.setMessages(prev => [...prev, errorMessage]);
					}
				}
			} else if (result.message) {
				// Display the message as a command message
				const commandMessage: Message = {
					role: 'command',
					content: result.message,
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			}
		},
		[stdout, options, t],
	);

	return {handleCommandExecution};
}
