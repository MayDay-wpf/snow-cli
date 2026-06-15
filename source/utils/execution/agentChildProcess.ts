import {fork, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

import {
	runningSubAgentTracker,
	type InterAgentMessage,
} from './runningSubAgentTracker.js';
import {
	teamTracker,
	type RunningTeammate,
	type TeammateMessage,
} from './teamTracker.js';
import type {
	AddToAlwaysApprovedCallback,
	SubAgentMessage,
	SubAgentResult,
	ToolApprovalChecker,
	ToolConfirmationCallback,
	UserQuestionCallback,
} from './subAgentTypes.js';
import type {
	TeammateExecutionOptions,
	TeammateExecutionResult,
} from './teamExecutor.js';

export interface ChildProcessRequestMessage {
	type: 'request';
	requestId: string;
	kind:
		| 'toolConfirmation'
		| 'isToolAutoApproved'
		| 'userQuestion'
		| 'addToAlwaysApproved';
	payload: any;
}

export interface ChildProcessResultMessage<T> {
	type: 'result';
	result: T;
}

export interface ChildProcessErrorMessage {
	type: 'error';
	error: string;
	stack?: string;
}

type AgentChildKind = 'subagent' | 'teammate';

type AgentChildProcessMessage<T> =
	| {type: 'ready'}
	| {type: 'event'; message: SubAgentMessage}
	| {type: 'teamTracker'; action: string; payload: any}
	| ChildProcessRequestMessage
	| ChildProcessResultMessage<T>
	| ChildProcessErrorMessage;

interface BaseChildPayload {
	kind: AgentChildKind;
	yoloMode?: boolean;
}

interface SubAgentChildPayload extends BaseChildPayload {
	kind: 'subagent';
	agentId: string;
	prompt: string;
	instanceId?: string;
	spawnDepth: number;
}

interface TeammateChildPayload extends BaseChildPayload {
	kind: 'teammate';
	memberId: string;
	memberName: string;
	prompt: string;
	worktreePath: string;
	teamName: string;
	instanceId: string;
	teammates: RunningTeammate[];
	role?: string;
	requirePlanApproval?: boolean;
}

export type AgentChildPayload = SubAgentChildPayload | TeammateChildPayload;

interface RunAgentChildProcessOptions {
	payload: AgentChildPayload;
	onMessage?: (message: SubAgentMessage) => void;
	abortSignal?: AbortSignal;
	requestToolConfirmation?: ToolConfirmationCallback;
	isToolAutoApproved?: ToolApprovalChecker;
	addToAlwaysApproved?: AddToAlwaysApprovedCallback;
	requestUserQuestion?: UserQuestionCallback;
	messagePump?: (child: ChildProcess) => NodeJS.Timeout | undefined;
	abortErrorMessage: string;
}

function getCliEntryPath(): string {
	const argvEntry = process.argv[1];
	if (argvEntry && existsSync(argvEntry)) {
		return argvEntry;
	}

	const fallback = resolve(process.cwd(), 'dist/cli.js');
	if (existsSync(fallback)) {
		return fallback;
	}

	throw new Error(
		'Unable to locate Snow CLI entrypoint for child-process agent execution',
	);
}

function safeSend(child: ChildProcess, message: any): boolean {
	if (!child.connected || child.killed) return false;
	try {
		child.send(message);
		return true;
	} catch {
		return false;
	}
}

function createSubAgentMessagePump(instanceId: string | undefined) {
	if (!instanceId) return undefined;

	return (child: ChildProcess): NodeJS.Timeout =>
		setInterval(() => {
			const userMessages = runningSubAgentTracker.dequeueMessages(instanceId);
			if (userMessages.length > 0) {
				safeSend(child, {
					type: 'injectSubAgentUserMessages',
					messages: userMessages,
				});
			}

			const interAgentMessages =
				runningSubAgentTracker.dequeueInterAgentMessages(instanceId);
			if (interAgentMessages.length > 0) {
				safeSend(child, {
					type: 'injectSubAgentInterAgentMessages',
					messages: interAgentMessages,
				});
			}
		}, 250);
}

function createTeammateMessagePump(instanceId: string) {
	return (child: ChildProcess): NodeJS.Timeout =>
		setInterval(() => {
			const messages = teamTracker.dequeueTeammateMessages(instanceId);
			if (messages.length > 0) {
				safeSend(child, {type: 'injectTeammateMessages', messages});
			}
		}, 250);
}

function handleChildTeamTrackerMessage(action: string, payload: any): void {
	switch (action) {
		case 'sendMessageToLead': {
			teamTracker.sendMessageToLead(payload.fromInstanceId, payload.content);
			break;
		}

		case 'sendMessageToTeammate': {
			teamTracker.sendMessageToTeammate(
				payload.fromInstanceId,
				payload.targetInstanceId,
				payload.content,
			);
			break;
		}

		case 'setStandby': {
			teamTracker.setStandby(payload.instanceId);
			break;
		}

		case 'clearStandby': {
			teamTracker.clearStandby(payload.instanceId);
			break;
		}

		case 'setCurrentTask': {
			teamTracker.setCurrentTask(payload.instanceId, payload.taskId);
			break;
		}

		case 'requestPlanApproval': {
			teamTracker.requestPlanApproval(payload.fromInstanceId, payload.plan);
			break;
		}
	}
}

async function handleChildRequest(
	message: ChildProcessRequestMessage,
	child: ChildProcess,
	options: Pick<
		RunAgentChildProcessOptions,
		| 'requestToolConfirmation'
		| 'isToolAutoApproved'
		| 'addToAlwaysApproved'
		| 'requestUserQuestion'
	>,
): Promise<void> {
	const reply = (payload: any) =>
		safeSend(child, {
			type: 'response',
			requestId: message.requestId,
			payload,
		});

	try {
		switch (message.kind) {
			case 'toolConfirmation': {
				const result = options.requestToolConfirmation
					? await options.requestToolConfirmation(
							message.payload.toolName,
							message.payload.toolArgs,
					  )
					: 'approve';
				reply({ok: true, value: result});
				break;
			}
			case 'isToolAutoApproved': {
				const value = options.isToolAutoApproved
					? options.isToolAutoApproved(message.payload.toolName)
					: false;
				reply({ok: true, value});
				break;
			}
			case 'addToAlwaysApproved': {
				if (options.addToAlwaysApproved) {
					options.addToAlwaysApproved(message.payload.toolName);
				}

				reply({ok: true, value: undefined});
				break;
			}
			case 'userQuestion': {
				if (!options.requestUserQuestion) {
					reply({
						ok: true,
						value: {
							selected: message.payload.options?.[0] ?? '',
							customInput: undefined,
						},
					});
					break;
				}

				const value = await options.requestUserQuestion(
					message.payload.question,
					message.payload.options,
					message.payload.multiSelect,
				);
				reply({ok: true, value});
				break;
			}
		}
	} catch (error) {
		reply({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function runAgentChildProcess<T>(
	options: RunAgentChildProcessOptions,
): Promise<T> {
	const child = fork(getCliEntryPath(), ['--snow-agent-child-worker'], {
		env: {...process.env, SNOW_AGENT_CHILD_PROCESS: '1'},
		stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
		execArgv: process.execArgv.filter(arg => !arg.startsWith('--inspect')),
	});

	let stderr = '';
	let settled = false;
	let messagePump: NodeJS.Timeout | undefined;
	let abortKillTimer: NodeJS.Timeout | undefined;

	const cleanup = () => {
		if (messagePump) clearInterval(messagePump);
		if (abortKillTimer) clearTimeout(abortKillTimer);
		child.removeAllListeners();
	};

	return await new Promise<T>((resolvePromise, rejectPromise) => {
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};

		const abortChild = () => {
			safeSend(child, {type: 'abort'});
			abortKillTimer = setTimeout(() => {
				if (!child.killed) child.kill('SIGTERM');
			}, 1500);
		};

		if (options.abortSignal?.aborted) {
			abortChild();
		}

		options.abortSignal?.addEventListener('abort', abortChild, {once: true});

		child.stderr?.on('data', chunk => {
			stderr += String(chunk);
			if (stderr.length > 20_000) {
				stderr = stderr.slice(-20_000);
			}
		});

		child.on('message', (raw: AgentChildProcessMessage<T>) => {
			if (!raw || typeof raw !== 'object') return;

			if (raw.type === 'ready') {
				safeSend(child, {type: 'start', payload: options.payload});
				messagePump = options.messagePump?.(child);
				return;
			}

			if (raw.type === 'event') {
				options.onMessage?.(raw.message);
				return;
			}

			if (raw.type === 'teamTracker') {
				handleChildTeamTrackerMessage(raw.action, raw.payload);
				return;
			}

			if (raw.type === 'request') {
				void handleChildRequest(raw, child, options);
				return;
			}

			if (raw.type === 'result') {
				finish(() => resolvePromise(raw.result));
				return;
			}

			if (raw.type === 'error') {
				finish(() => rejectPromise(new Error(raw.error)));
			}
		});

		child.on('error', error => {
			finish(() => rejectPromise(error));
		});

		child.on('exit', (code, signal) => {
			if (settled) return;
			const aborted = options.abortSignal?.aborted;
			const details = stderr.trim() ? `\nChild stderr:\n${stderr.trim()}` : '';
			finish(() =>
				rejectPromise(
					new Error(
						aborted
							? options.abortErrorMessage
							: `Agent child process exited before returning a result (code=${
									code ?? 'null'
							  }, signal=${signal ?? 'null'}).${details}`,
					),
				),
			);
		});
	});
}

export async function executeSubAgentInChildProcess(
	agentId: string,
	prompt: string,
	onMessage?: (message: SubAgentMessage) => void,
	abortSignal?: AbortSignal,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
	requestUserQuestion?: UserQuestionCallback,
	instanceId?: string,
	spawnDepth: number = 0,
): Promise<SubAgentResult> {
	return await runAgentChildProcess<SubAgentResult>({
		payload: {
			kind: 'subagent',
			agentId,
			prompt,
			instanceId,
			spawnDepth,
			yoloMode,
		},
		onMessage,
		abortSignal,
		requestToolConfirmation,
		isToolAutoApproved,
		addToAlwaysApproved,
		requestUserQuestion,
		messagePump: createSubAgentMessagePump(instanceId),
		abortErrorMessage: 'Sub-agent execution aborted',
	});
}

export async function executeTeammateInChildProcess(
	memberId: string,
	memberName: string,
	prompt: string,
	worktreePath: string,
	teamName: string,
	role: string | undefined,
	options: TeammateExecutionOptions,
	instanceId: string,
): Promise<TeammateExecutionResult> {
	return await runAgentChildProcess<TeammateExecutionResult>({
		payload: {
			kind: 'teammate',
			memberId,
			memberName,
			prompt,
			worktreePath,
			teamName,
			instanceId,
			teammates: teamTracker.getRunningTeammates(),
			role,
			yoloMode: options.yoloMode,
			requirePlanApproval: options.requirePlanApproval,
		},
		onMessage: options.onMessage,
		abortSignal: options.abortSignal,
		requestToolConfirmation: options.requestToolConfirmation,
		isToolAutoApproved: options.isToolAutoApproved,
		addToAlwaysApproved: options.addToAlwaysApproved,
		requestUserQuestion: options.requestUserQuestion,
		messagePump: createTeammateMessagePump(instanceId),
		abortErrorMessage: 'Teammate execution aborted',
	});
}

export type {InterAgentMessage, TeammateMessage};
