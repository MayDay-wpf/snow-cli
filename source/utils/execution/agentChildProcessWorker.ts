import {executeSubAgent} from './subAgentExecutor.js';
import {executeTeammate} from './teamExecutor.js';
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
	AgentChildPayload,
	ChildProcessRequestMessage,
} from './agentChildProcess.js';

interface PendingRequest {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
}

const pendingRequests = new Map<string, PendingRequest>();
let requestCounter = 0;
let abortController: AbortController | undefined;

function send(message: any): void {
	if (process.send) {
		process.send(message);
	}
}

function requestParent(
	kind: ChildProcessRequestMessage['kind'],
	payload: any,
): Promise<any> {
	const requestId = `req-${Date.now()}-${++requestCounter}`;
	send({type: 'request', requestId, kind, payload});
	return new Promise((resolve, reject) => {
		pendingRequests.set(requestId, {resolve, reject});
	});
}

function handleParentResponse(message: any): void {
	const pending = pendingRequests.get(message.requestId);
	if (!pending) return;
	pendingRequests.delete(message.requestId);

	if (message.payload?.ok) {
		pending.resolve(message.payload.value);
	} else {
		pending.reject(
			new Error(message.payload?.error || 'Child-process request failed'),
		);
	}
}

function installMessageInjectionHandlers(): void {
	process.on('message', message => {
		if (!message || typeof message !== 'object') return;

		if ((message as any).type === 'response') {
			handleParentResponse(message);
			return;
		}

		if ((message as any).type === 'abort') {
			abortController?.abort();
			return;
		}

		if ((message as any).type === 'injectSubAgentUserMessages') {
			const messages = ((message as any).messages || []) as string[];
			for (const current of messages) {
				const agents = runningSubAgentTracker.getRunningAgents();
				for (const agent of agents) {
					runningSubAgentTracker.enqueueMessage(agent.instanceId, current);
				}
			}
			return;
		}

		if ((message as any).type === 'injectSubAgentInterAgentMessages') {
			const messages = ((message as any).messages || []) as InterAgentMessage[];
			for (const current of messages) {
				const agents = runningSubAgentTracker.getRunningAgents();
				for (const agent of agents) {
					runningSubAgentTracker.enqueueExternalInterAgentMessage(
						agent.instanceId,
						current,
					);
				}
			}
			return;
		}

		if ((message as any).type === 'injectTeammateMessages') {
			const messages = ((message as any).messages || []) as TeammateMessage[];
			for (const current of messages) {
				const teammates = teamTracker.getRunningTeammates();
				for (const teammate of teammates) {
					teamTracker.enqueueExternalTeammateMessage(
						teammate.instanceId,
						current,
					);
				}
			}
		}
	});
}

async function runSubAgentPayload(
	payload: Extract<AgentChildPayload, {kind: 'subagent'}>,
) {
	if (payload.instanceId) {
		runningSubAgentTracker.register({
			instanceId: payload.instanceId,
			agentId: payload.agentId,
			agentName: payload.agentId,
			prompt: payload.prompt,
			startedAt: new Date(),
		});
	}

	try {
		return await executeSubAgent(
			payload.agentId,
			payload.prompt,
			message => send({type: 'event', message}),
			abortController?.signal,
			async (toolName, toolArgs) =>
				await requestParent('toolConfirmation', {toolName, toolArgs}),
			toolName => {
				void requestParent('isToolAutoApproved', {toolName});
				return false;
			},
			payload.yoloMode,
			toolName => {
				void requestParent('addToAlwaysApproved', {toolName});
			},
			async (question, options, multiSelect) =>
				await requestParent('userQuestion', {question, options, multiSelect}),
			payload.instanceId,
			payload.spawnDepth,
		);
	} finally {
		if (payload.instanceId) {
			runningSubAgentTracker.unregister(payload.instanceId);
		}
	}
}

function sendTeamTrackerAction(action: string, payload: any): void {
	send({type: 'teamTracker', action, payload});
}

function registerTeammateSnapshots(teammates: RunningTeammate[]): void {
	for (const teammate of teammates) {
		if (teamTracker.getTeammate(teammate.instanceId)) continue;
		teamTracker.register({
			...teammate,
			startedAt: new Date(teammate.startedAt),
		});
	}
}

function bridgeTeamTrackerToParent(): void {
	const tracker = teamTracker as any;
	if (tracker.__snowChildBridgeInstalled) return;
	tracker.__snowChildBridgeInstalled = true;

	const originalSendMessageToLead = tracker.sendMessageToLead.bind(teamTracker);
	tracker.sendMessageToLead = (fromInstanceId: string, content: string) => {
		sendTeamTrackerAction('sendMessageToLead', {fromInstanceId, content});
		return originalSendMessageToLead(fromInstanceId, content) || true;
	};

	const originalSendMessageToTeammate =
		tracker.sendMessageToTeammate.bind(teamTracker);
	tracker.sendMessageToTeammate = (
		fromInstanceId: string | 'lead',
		targetInstanceId: string,
		content: string,
	) => {
		sendTeamTrackerAction('sendMessageToTeammate', {
			fromInstanceId,
			targetInstanceId,
			content,
		});
		return (
			originalSendMessageToTeammate(
				fromInstanceId,
				targetInstanceId,
				content,
			) || true
		);
	};

	const originalSetStandby = tracker.setStandby.bind(teamTracker);
	tracker.setStandby = (instanceId: string) => {
		sendTeamTrackerAction('setStandby', {instanceId});
		return originalSetStandby(instanceId);
	};

	const originalClearStandby = tracker.clearStandby.bind(teamTracker);
	tracker.clearStandby = (instanceId: string) => {
		sendTeamTrackerAction('clearStandby', {instanceId});
		return originalClearStandby(instanceId);
	};

	const originalSetCurrentTask = tracker.setCurrentTask.bind(teamTracker);
	tracker.setCurrentTask = (instanceId: string, taskId: string | undefined) => {
		sendTeamTrackerAction('setCurrentTask', {instanceId, taskId});
		return originalSetCurrentTask(instanceId, taskId);
	};

	const originalRequestPlanApproval =
		tracker.requestPlanApproval.bind(teamTracker);
	tracker.requestPlanApproval = (fromInstanceId: string, plan: string) => {
		sendTeamTrackerAction('requestPlanApproval', {fromInstanceId, plan});
		return originalRequestPlanApproval(fromInstanceId, plan) || true;
	};
}

async function runTeammatePayload(
	payload: Extract<AgentChildPayload, {kind: 'teammate'}>,
) {
	registerTeammateSnapshots(payload.teammates);
	bridgeTeamTrackerToParent();

	return await executeTeammate(
		payload.memberId,
		payload.memberName,
		payload.prompt,
		payload.worktreePath,
		payload.teamName,
		payload.role,
		{
			onMessage: message => send({type: 'event', message}),
			abortSignal: abortController?.signal,
			requestToolConfirmation: async (toolName, toolArgs) =>
				await requestParent('toolConfirmation', {toolName, toolArgs}),
			isToolAutoApproved: toolName => {
				void requestParent('isToolAutoApproved', {toolName});
				return false;
			},
			yoloMode: payload.yoloMode,
			addToAlwaysApproved: toolName => {
				void requestParent('addToAlwaysApproved', {toolName});
			},
			requestUserQuestion: async (question, options, multiSelect) =>
				await requestParent('userQuestion', {question, options, multiSelect}),
			requirePlanApproval: payload.requirePlanApproval,
			instanceId: payload.instanceId,
		},
	);
}

export async function runAgentChildProcessWorker(): Promise<void> {
	if (!process.send) {
		throw new Error('Agent child-process worker requires an IPC channel');
	}

	installMessageInjectionHandlers();
	abortController = new AbortController();
	send({type: 'ready'});

	await new Promise<void>(resolve => {
		let started = false;

		process.on('message', message => {
			if (!message || typeof message !== 'object') return;
			if ((message as any).type !== 'start') return;
			if (started) return;
			started = true;

			void (async () => {
				try {
					const payload = (message as any).payload as AgentChildPayload;
					const result =
						payload.kind === 'subagent'
							? await runSubAgentPayload(payload)
							: await runTeammatePayload(payload);
					send({type: 'result', result});
				} catch (error) {
					send({
						type: 'error',
						error: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					});
				} finally {
					setImmediate(resolve);
				}
			})();
		});
	});
}
