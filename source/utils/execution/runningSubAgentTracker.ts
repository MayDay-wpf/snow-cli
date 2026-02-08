/**
 * Running Sub-Agent Tracker
 * A singleton that tracks currently running sub-agents.
 * Provides subscription mechanism for React components to observe changes,
 * and a per-instance message queue for injecting user messages into running sub-agents.
 */

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

type Listener = () => void;

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
	 * Register a running sub-agent
	 */
	register(agent: RunningSubAgent): void {
		this.agents.set(agent.instanceId, agent);
		this.messageQueues.set(agent.instanceId, []);
		this.rebuildSnapshot();
		this.notifyListeners();
	}

	/**
	 * Unregister a sub-agent when it completes
	 */
	unregister(instanceId: string): void {
		if (this.agents.delete(instanceId)) {
			this.messageQueues.delete(instanceId);
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
		if (this.agents.size > 0) {
			this.agents.clear();
			this.messageQueues.clear();
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
