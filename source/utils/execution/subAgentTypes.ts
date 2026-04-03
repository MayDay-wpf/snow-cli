import type {ConfirmationResult} from '../../ui/components/tools/ToolConfirmation.js';
import type {ChatMessage} from '../../api/chat.js';

export type {ChatMessage};

export interface SubAgentMessage {
	type: 'sub_agent_message';
	agentId: string;
	agentName: string;
	message: any;
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
}

export interface SubAgentResult {
	success: boolean;
	result: string;
	error?: string;
	usage?: TokenUsage;
	/** User messages injected from the main session during sub-agent execution */
	injectedUserMessages?: string[];
	/** Internal stop/summarize instructions injected by the executor */
	terminationInstructions?: string[];
}

export interface ToolConfirmationCallback {
	(toolName: string, toolArgs: any): Promise<ConfirmationResult>;
}

export interface ToolApprovalChecker {
	(toolName: string): boolean;
}

export interface AddToAlwaysApprovedCallback {
	(toolName: string): void;
}

/**
 * 用户问题回调接口
 * 用于子智能体调用 askuser 工具时，请求主会话显示蓝色边框的 AskUserQuestion 组件
 * @param question - 问题文本
 * @param options - 选项列表
 * @param multiSelect - 是否多选模式
 * @returns 用户选择的结果
 */
export interface UserQuestionCallback {
	(question: string, options: string[], multiSelect?: boolean): Promise<{
		selected: string | string[];
		customInput?: string;
	}>;
}

export interface SubAgentExecutionContext {
	agent: any;
	instanceId?: string;
	messages: ChatMessage[];
	onMessage?: (message: SubAgentMessage) => void;
	abortSignal?: AbortSignal;
	requestToolConfirmation?: ToolConfirmationCallback;
	isToolAutoApproved?: ToolApprovalChecker;
	yoloMode: boolean;
	addToAlwaysApproved?: AddToAlwaysApprovedCallback;
	requestUserQuestion?: UserQuestionCallback;
	spawnDepth: number;
	sessionApprovedTools: Set<string>;
	spawnedChildInstanceIds: Set<string>;
	collectedInjectedMessages: string[];
	collectedTerminationInstructions: string[];
	latestTotalTokens: number;
	totalUsage?: TokenUsage;
	finalResponse: string;
}

export function emitSubAgentMessage(
	ctx: SubAgentExecutionContext,
	message: any,
): void {
	if (ctx.onMessage) {
		ctx.onMessage({
			type: 'sub_agent_message',
			agentId: ctx.agent.id,
			agentName: ctx.agent.name,
			message,
		});
	}
}
