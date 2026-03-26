/**
 * Team Tracker
 * Tracks running teammates in an Agent Team session.
 * Provides message routing (direct + broadcast), plan approval queue,
 * and task status integration.
 */

export interface TeammateMessage {
	fromInstanceId: string;
	fromMemberId: string;
	fromMemberName: string;
	content: string;
	sentAt: Date;
}

export interface RunningTeammate {
	instanceId: string;
	memberId: string;
	memberName: string;
	role?: string;
	worktreePath: string;
	teamName: string;
	prompt: string;
	startedAt: Date;
	currentTaskId?: string;
}

export interface TeammateResult {
	instanceId: string;
	memberId: string;
	memberName: string;
	success: boolean;
	result: string;
	error?: string;
	completedAt: Date;
}

export interface PlanApprovalRequest {
	fromInstanceId: string;
	fromMemberId: string;
	fromMemberName: string;
	plan: string;
	requestedAt: Date;
	status: 'pending' | 'approved' | 'rejected';
	feedback?: string;
}

export interface TeammateMessageEvent {
	from: RunningTeammate;
	to: RunningTeammate | 'lead';
	message: TeammateMessage;
	isBroadcast: boolean;
}

type Listener = () => void;
type MessageListener = (event: TeammateMessageEvent) => void;

class TeamTracker {
	private teammates: Map<string, RunningTeammate> = new Map();
	private listeners: Set<Listener> = new Set();
	private cachedSnapshot: RunningTeammate[] = [];

	/** Messages from teammates → lead */
	private leadMessageQueue: TeammateMessage[] = [];

	/** Messages from lead/teammates → specific teammate */
	private teammateMessageQueues: Map<string, TeammateMessage[]> = new Map();

	/** Completed teammate results awaiting lead consumption */
	private completedResults: TeammateResult[] = [];

	/** Plan approval requests from teammates */
	private planApprovals: PlanApprovalRequest[] = [];

	private messageListeners: Set<MessageListener> = new Set();

	/** Active team name (only one team at a time) */
	private activeTeamName: string | null = null;

	/** Per-teammate AbortControllers for force-stopping during rollback */
	private teammateAbortControllers: Map<string, AbortController> = new Map();

	/** Teammates currently in standby (called wait_for_messages) */
	private standbySet: Set<string> = new Set();

	// ── Team lifecycle ──

	setActiveTeam(teamName: string): void {
		this.activeTeamName = teamName;
	}

	getActiveTeamName(): string | null {
		return this.activeTeamName;
	}

	clearActiveTeam(): void {
		this.activeTeamName = null;
		this.clear();
	}

	// ── Teammate registration ──

	register(teammate: RunningTeammate): void {
		this.teammates.set(teammate.instanceId, teammate);
		this.teammateMessageQueues.set(teammate.instanceId, []);
		this.rebuildSnapshot();
		this.notifyListeners();
	}

	unregister(instanceId: string): void {
		if (this.teammates.delete(instanceId)) {
			this.teammateMessageQueues.delete(instanceId);
			this.teammateAbortControllers.delete(instanceId);
			this.standbySet.delete(instanceId);
			this.rebuildSnapshot();
			this.notifyListeners();
		}
	}

	/**
	 * Create and store an AbortController for a teammate.
	 * If a parent abort signal is provided, it will be linked so the teammate
	 * aborts when either the parent fires or abortAllTeammates() is called.
	 */
	createAbortController(instanceId: string, parentSignal?: AbortSignal): AbortController {
		const controller = new AbortController();
		this.teammateAbortControllers.set(instanceId, controller);
		if (parentSignal) {
			const onParentAbort = () => controller.abort();
			parentSignal.addEventListener('abort', onParentAbort, {once: true});
		}
		return controller;
	}

	/**
	 * Get the AbortController for a specific teammate by member ID.
	 */
	getAbortController(memberId: string): AbortController | undefined {
		return this.teammateAbortControllers.get(memberId);
	}

	/**
	 * Abort all running teammates (used during rollback).
	 */
	abortAllTeammates(): void {
		for (const controller of this.teammateAbortControllers.values()) {
			try { controller.abort(); } catch { /* noop */ }
		}
		this.teammateAbortControllers.clear();
	}

	getRunningTeammates(): RunningTeammate[] {
		return this.cachedSnapshot;
	}

	// ── Standby tracking ──

	setStandby(instanceId: string): void {
		if (this.teammates.has(instanceId)) {
			this.standbySet.add(instanceId);
			this.notifyListeners();
		}
	}

	clearStandby(instanceId: string): void {
		if (this.standbySet.delete(instanceId)) {
			this.notifyListeners();
		}
	}

	isOnStandby(instanceId: string): boolean {
		return this.standbySet.has(instanceId);
	}

	/**
	 * Check if all running teammates are in standby (or no teammates are running).
	 */
	allInStandby(): boolean {
		if (this.teammates.size === 0) return true;
		for (const instanceId of this.teammates.keys()) {
			if (!this.standbySet.has(instanceId)) return false;
		}
		return true;
	}

	getCount(): number {
		return this.teammates.size;
	}

	isRunning(instanceId: string): boolean {
		return this.teammates.has(instanceId);
	}

	getTeammate(instanceId: string): RunningTeammate | undefined {
		return this.teammates.get(instanceId);
	}

	findByMemberId(memberId: string): RunningTeammate | undefined {
		for (const t of this.teammates.values()) {
			if (t.memberId === memberId) return t;
		}
		return undefined;
	}

	findByMemberName(memberName: string): RunningTeammate | undefined {
		const lowerName = memberName.toLowerCase();
		for (const t of this.teammates.values()) {
			if (t.memberName.toLowerCase() === lowerName) return t;
		}
		return undefined;
	}

	// ── Messaging: teammate → lead ──

	sendMessageToLead(
		fromInstanceId: string,
		content: string,
	): boolean {
		const from = this.teammates.get(fromInstanceId);
		if (!from) return false;

		const message: TeammateMessage = {
			fromInstanceId,
			fromMemberId: from.memberId,
			fromMemberName: from.memberName,
			content,
			sentAt: new Date(),
		};
		this.leadMessageQueue.push(message);

		this.notifyMessageListeners({
			from,
			to: 'lead',
			message,
			isBroadcast: false,
		});
		return true;
	}

	dequeueLeadMessages(): TeammateMessage[] {
		if (this.leadMessageQueue.length === 0) return [];
		const messages = [...this.leadMessageQueue];
		this.leadMessageQueue.length = 0;
		return messages;
	}

	// ── Messaging: lead/teammate → teammate ──

	sendMessageToTeammate(
		fromInstanceId: string | 'lead',
		targetInstanceId: string,
		content: string,
	): boolean {
		const queue = this.teammateMessageQueues.get(targetInstanceId);
		if (!queue) return false;

		const from = fromInstanceId === 'lead'
			? null
			: this.teammates.get(fromInstanceId);

		const message: TeammateMessage = {
			fromInstanceId: fromInstanceId === 'lead' ? 'lead' : fromInstanceId,
			fromMemberId: from?.memberId || 'lead',
			fromMemberName: from?.memberName || 'Team Lead',
			content,
			sentAt: new Date(),
		};
		queue.push(message);

		const target = this.teammates.get(targetInstanceId);
		if (target) {
			this.notifyMessageListeners({
				from: from || ({instanceId: 'lead', memberId: 'lead', memberName: 'Team Lead'} as RunningTeammate),
				to: target,
				message,
				isBroadcast: false,
			});
		}
		return true;
	}

	dequeueTeammateMessages(instanceId: string): TeammateMessage[] {
		const queue = this.teammateMessageQueues.get(instanceId);
		if (!queue || queue.length === 0) return [];
		const messages = [...queue];
		queue.length = 0;
		return messages;
	}

	// ── Broadcast: lead → all teammates ──

	broadcastToTeammates(
		fromInstanceId: string | 'lead',
		content: string,
	): number {
		let count = 0;
		for (const instanceId of this.teammates.keys()) {
			if (instanceId !== fromInstanceId) {
				this.sendMessageToTeammate(fromInstanceId, instanceId, content);
				count++;
			}
		}
		return count;
	}

	// ── Completed results ──

	storeResult(result: TeammateResult): void {
		this.completedResults.push(result);
		this.notifyListeners();
	}

	drainResults(): TeammateResult[] {
		if (this.completedResults.length === 0) return [];
		const results = [...this.completedResults];
		this.completedResults.length = 0;
		return results;
	}

	hasResults(): boolean {
		return this.completedResults.length > 0;
	}

	// ── Plan approval ──

	requestPlanApproval(
		fromInstanceId: string,
		plan: string,
	): boolean {
		const from = this.teammates.get(fromInstanceId);
		if (!from) return false;

		this.planApprovals.push({
			fromInstanceId,
			fromMemberId: from.memberId,
			fromMemberName: from.memberName,
			plan,
			requestedAt: new Date(),
			status: 'pending',
		});

		this.sendMessageToLead(fromInstanceId, `[Plan Approval Request]\n${plan}`);
		return true;
	}

	getPendingApprovals(): PlanApprovalRequest[] {
		return this.planApprovals.filter(a => a.status === 'pending');
	}

	resolvePlanApproval(
		fromInstanceId: string,
		approved: boolean,
		feedback?: string,
	): boolean {
		const approval = this.planApprovals.find(
			a => a.fromInstanceId === fromInstanceId && a.status === 'pending',
		);
		if (!approval) return false;

		approval.status = approved ? 'approved' : 'rejected';
		approval.feedback = feedback;

		const content = approved
			? `Your plan has been approved.${feedback ? ` Feedback: ${feedback}` : ''}`
			: `Your plan has been rejected.${feedback ? ` Feedback: ${feedback}` : ' Please revise and resubmit.'}`;

		this.sendMessageToTeammate('lead', fromInstanceId, content);
		return true;
	}

	// ── Wait for all teammates ──

	/**
	 * Wait until all running teammates are in standby or have been unregistered.
	 * Resolves true when all teammates are idle/done, false on timeout/abort.
	 */
	waitForAllTeammates(
		timeoutMs = 600_000,
		abortSignal?: AbortSignal,
	): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			if (this.allInStandby()) {
				resolve(true);
				return;
			}

			const startTime = Date.now();
			let unsubscribe: (() => void) | undefined;

			const checkDone = () => {
				if (abortSignal?.aborted) {
					cleanup();
					resolve(false);
					return;
				}
				if (this.allInStandby()) {
					cleanup();
					resolve(true);
					return;
				}
				if (Date.now() - startTime > timeoutMs) {
					cleanup();
					resolve(false);
					return;
				}
			};

			const cleanup = () => {
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = undefined;
				}
			};

			unsubscribe = this.subscribe(() => {
				checkDone();
			});

			if (abortSignal) {
				abortSignal.addEventListener('abort', () => {
					cleanup();
					resolve(false);
				}, {once: true});
			}

			checkDone();
		});
	}

	// ── Task tracking ──

	setCurrentTask(instanceId: string, taskId: string | undefined): void {
		const teammate = this.teammates.get(instanceId);
		if (teammate) {
			teammate.currentTaskId = taskId;
		}
	}

	// ── Subscription ──

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	onMessage(listener: MessageListener): () => void {
		this.messageListeners.add(listener);
		return () => {
			this.messageListeners.delete(listener);
		};
	}

	// ── Cleanup ──

	clear(): void {
		if (
			this.teammates.size > 0 ||
			this.completedResults.length > 0 ||
			this.leadMessageQueue.length > 0
		) {
			this.abortAllTeammates();
			this.teammates.clear();
			this.teammateMessageQueues.clear();
			this.standbySet.clear();
			this.leadMessageQueue.length = 0;
			this.completedResults.length = 0;
			this.planApprovals.length = 0;
			this.rebuildSnapshot();
			this.notifyListeners();
		}
	}

	// ── Internal ──

	private rebuildSnapshot(): void {
		this.cachedSnapshot = Array.from(this.teammates.values());
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// Ignore listener errors
			}
		}
	}

	private notifyMessageListeners(event: TeammateMessageEvent): void {
		for (const listener of this.messageListeners) {
			try {
				listener(event);
			} catch {
				// Ignore listener errors
			}
		}
	}
}

export const teamTracker = new TeamTracker();
