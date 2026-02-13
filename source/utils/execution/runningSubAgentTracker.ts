/**
 * Running Sub-Agent Tracker
 * A singleton that tracks currently running sub-agents.
 * Provides subscription mechanism for React components to observe changes,
 * and a per-instance message queue for injecting user messages into running sub-agents.
 */

export interface InterAgentMessage {
	/** Instance ID of the sender sub-agent */
	fromInstanceId: string;
	/** Agent ID of the sender (e.g. 'agent_explore') */
	fromAgentId: string;
	/** Human-readable name of the sender agent */
	fromAgentName: string;
	/** The message content */
	content: string;
	/** Timestamp when the message was sent */
	sentAt: Date;
}

export interface RunningSubAgent {
	/** Unique instance ID (typically the tool call ID) */
	instanceId: string;
	/** Agent type ID, e.g., 'agent_explore' */
	agentId: string;
	/** Human-readable agent name, e.g., 'Explore Agent' */
	agentName: string;
	/** The prompt sent to the sub-agent (used to distinguish parallel instances) */
	prompt: string;
	/** When this sub-agent started */
	startedAt: Date;
}

/**
 * Result from a sub-agent that was spawned by another sub-agent.
 * Stored here until the main conversation flow picks it up.
 */
export interface SpawnedAgentResult {
	instanceId: string;
	agentId: string;
	agentName: string;
	prompt: string;
	success: boolean;
	result: string;
	error?: string;
	completedAt: Date;
	/** Who requested the spawn */
	spawnedBy: {
		instanceId: string;
		agentId: string;
		agentName: string;
	};
}

type Listener = () => void;

export interface InterAgentMessageEvent {
	from: RunningSubAgent;
	to: RunningSubAgent;
	message: InterAgentMessage;
}

type InterAgentMessageListener = (event: InterAgentMessageEvent) => void;

class RunningSubAgentTracker {
	private agents: Map<string, RunningSubAgent> = new Map();
	private listeners: Set<Listener> = new Set();
	/**
	 * Cached snapshot array for useSyncExternalStore compatibility.
	 * useSyncExternalStore requires getSnapshot to return the same reference
	 * if the data hasn't changed, so we cache it and only rebuild on mutation.
	 */
	private cachedSnapshot: RunningSubAgent[] = [];

	/**
	 * Per-instance message queue.
	 * Messages queued here are consumed by the sub-agent executor's while loop
	 * and injected as "user" messages into the sub-agent conversation.
	 */
	private messageQueues: Map<string, string[]> = new Map();

	/**
	 * Per-instance inter-agent message queue.
	 * Messages sent from one sub-agent to another via the send_message_to_agent tool.
	 * Consumed by the receiving sub-agent's while loop and injected as context.
	 */
	private interAgentQueues: Map<string, InterAgentMessage[]> = new Map();

	/**
	 * Completed results from sub-agents spawned by other sub-agents.
	 * Drained by the main conversation flow and injected as user messages.
	 */
	private spawnedResults: SpawnedAgentResult[] = [];

	/**
	 * Register a running sub-agent
	 */
	register(agent: RunningSubAgent): void {
		this.agents.set(agent.instanceId, agent);
		this.messageQueues.set(agent.instanceId, []);
		this.interAgentQueues.set(agent.instanceId, []);
		this.rebuildSnapshot();
		this.notifyListeners();
	}

	/**
	 * Unregister a sub-agent when it completes
	 */
	unregister(instanceId: string): void {
		if (this.agents.delete(instanceId)) {
			this.messageQueues.delete(instanceId);
			this.interAgentQueues.delete(instanceId);
			this.rebuildSnapshot();
			this.notifyListeners();
		}
	}

	/**
	 * Get all currently running sub-agents (returns cached snapshot).
	 * Safe for useSyncExternalStore - returns the same reference
	 * until the data changes.
	 */
	getRunningAgents(): RunningSubAgent[] {
		return this.cachedSnapshot;
	}

	/**
	 * Get count of currently running sub-agents
	 */
	getCount(): number {
		return this.agents.size;
	}

	/**
	 * Check if a sub-agent instance is still running.
	 */
	isRunning(instanceId: string): boolean {
		return this.agents.has(instanceId);
	}

	/**
	 * Check if there are any spawned sub-agents still running.
	 * Spawned agents have instanceIds starting with "spawn-".
	 */
	hasRunningSpawnedAgents(): boolean {
		for (const instanceId of this.agents.keys()) {
			if (instanceId.startsWith('spawn-')) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Wait for all spawned agents to complete, with a timeout.
	 * Resolves when all spawned agents finish or the timeout is reached.
	 * @param timeoutMs Maximum time to wait in milliseconds (default: 5 minutes)
	 * @param abortSignal Optional abort signal to cancel waiting early
	 * @returns true if all spawned agents completed, false if timed out or aborted
	 */
	waitForSpawnedAgents(
		timeoutMs = 300_000,
		abortSignal?: AbortSignal,
	): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			// Quick check: no spawned agents running
			if (!this.hasRunningSpawnedAgents()) {
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
				if (!this.hasRunningSpawnedAgents()) {
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

			// Subscribe to agent changes so we get notified when agents unregister
			unsubscribe = this.subscribe(() => {
				checkDone();
			});

			// Also handle abort signal
			if (abortSignal) {
				abortSignal.addEventListener('abort', () => {
					cleanup();
					resolve(false);
				}, {once: true});
			}

			// Initial check (in case they all finished between our first check and subscribe)
			checkDone();
		});
	}

	// ── Message queue for injecting user messages into running sub-agents ──

	/**
	 * Enqueue a user message for a running sub-agent.
	 * The sub-agent executor polls this queue and injects messages as "user" turns.
	 * Returns true if the agent is still running and the message was enqueued.
	 */
	enqueueMessage(instanceId: string, message: string): boolean {
		const queue = this.messageQueues.get(instanceId);
		if (!queue) {
			return false; // Agent is not running
		}

		queue.push(message);
		return true;
	}

	/**
	 * Dequeue all pending messages for a sub-agent instance.
	 * Called by the sub-agent executor at the top of each while-loop iteration.
	 * Returns an empty array if no messages are pending.
	 */
	dequeueMessages(instanceId: string): string[] {
		const queue = this.messageQueues.get(instanceId);
		if (!queue || queue.length === 0) {
			return [];
		}

		// Drain the queue and return all messages
		const messages = [...queue];
		queue.length = 0;
		return messages;
	}

	// ── Inter-agent messaging ──────────────────────────────────────────────

	/**
	 * Send a message from one sub-agent to another.
	 * The message is queued for the target and also triggers a listener notification
	 * so that the UI can display the inter-agent communication.
	 * Returns true if the target agent is running and the message was enqueued.
	 */
	sendInterAgentMessage(
		fromInstanceId: string,
		targetInstanceId: string,
		content: string,
	): boolean {
		const queue = this.interAgentQueues.get(targetInstanceId);
		if (!queue) {
			return false; // Target agent is not running
		}
		const fromAgent = this.agents.get(fromInstanceId);
		if (!fromAgent) {
			return false; // Sender agent is not running
		}

		const message: InterAgentMessage = {
			fromInstanceId,
			fromAgentId: fromAgent.agentId,
			fromAgentName: fromAgent.agentName,
			content,
			sentAt: new Date(),
		};
		queue.push(message);

		// Notify listeners so UI can react to the new inter-agent message
		this.notifyInterAgentListeners(fromAgent, targetInstanceId, message);
		return true;
	}

	/**
	 * Dequeue all pending inter-agent messages for a sub-agent instance.
	 * Called by the sub-agent executor at the top of each while-loop iteration.
	 */
	dequeueInterAgentMessages(instanceId: string): InterAgentMessage[] {
		const queue = this.interAgentQueues.get(instanceId);
		if (!queue || queue.length === 0) {
			return [];
		}
		const messages = [...queue];
		queue.length = 0;
		return messages;
	}

	/**
	 * Find a running sub-agent instance by agentId (type).
	 * If multiple instances of the same type are running, returns the first match.
	 * Use this to resolve agentId -> instanceId for inter-agent messaging.
	 */
	findInstanceByAgentId(agentId: string): RunningSubAgent | undefined {
		for (const agent of this.agents.values()) {
			if (agent.agentId === agentId) {
				return agent;
			}
		}
		return undefined;
	}

	/**
	 * Find all running sub-agent instances by agentId (type).
	 */
	findAllInstancesByAgentId(agentId: string): RunningSubAgent[] {
		const result: RunningSubAgent[] = [];
		for (const agent of this.agents.values()) {
			if (agent.agentId === agentId) {
				result.push(agent);
			}
		}
		return result;
	}

	// ── Inter-agent message listeners (for UI notifications) ──

	private interAgentListeners: Set<InterAgentMessageListener> = new Set();

	onInterAgentMessage(listener: InterAgentMessageListener): () => void {
		this.interAgentListeners.add(listener);
		return () => {
			this.interAgentListeners.delete(listener);
		};
	}

	private notifyInterAgentListeners(
		fromAgent: RunningSubAgent,
		targetInstanceId: string,
		message: InterAgentMessage,
	): void {
		const targetAgent = this.agents.get(targetInstanceId);
		if (!targetAgent) return;

		for (const listener of this.interAgentListeners) {
			try {
				listener({
					from: fromAgent,
					to: targetAgent,
					message,
				});
			} catch {
				// Ignore listener errors
			}
		}
	}

	// ── Spawned agent result storage ──────────────────────────────────────

	/**
	 * Store the result of a sub-agent that was spawned by another sub-agent.
	 * The main conversation flow drains these between tool execution rounds.
	 */
	storeSpawnedResult(result: SpawnedAgentResult): void {
		this.spawnedResults.push(result);
		// Notify listeners so the UI knows a spawned agent finished
		this.notifyListeners();
	}

	/**
	 * Drain all completed spawned agent results.
	 * Called by the main conversation flow to inject results as context.
	 * Returns an empty array if no results are pending.
	 */
	drainSpawnedResults(): SpawnedAgentResult[] {
		if (this.spawnedResults.length === 0) {
			return [];
		}
		const results = [...this.spawnedResults];
		this.spawnedResults.length = 0;
		return results;
	}

	/**
	 * Check if there are any pending spawned agent results.
	 */
	hasSpawnedResults(): boolean {
		return this.spawnedResults.length > 0;
	}

	/**
	 * Subscribe to changes in the running agents list.
	 * Returns an unsubscribe function.
	 */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Clear all running agents (useful for cleanup)
	 */
	clear(): void {
		if (this.agents.size > 0 || this.spawnedResults.length > 0) {
			this.agents.clear();
			this.messageQueues.clear();
			this.interAgentQueues.clear();
			this.spawnedResults.length = 0;
			this.rebuildSnapshot();
			this.notifyListeners();
		}
	}

	private rebuildSnapshot(): void {
		this.cachedSnapshot = Array.from(this.agents.values());
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
}

export const runningSubAgentTracker = new RunningSubAgentTracker();
