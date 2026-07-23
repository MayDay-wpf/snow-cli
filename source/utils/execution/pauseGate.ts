/** PauseGate - AI Loop 暂停/继续控制
 *
 * 核心思想：当用户执行 /pause 指令时，AI Loop 在下一轮（AI 向模型返回信息时）
 * 阻塞等待，直到用户执行 /continue 或 ESC 中断。
 *
 * 工作原理：
 * - pause(): 设置 paused=true，通知监听者
 * - resume(): 设置 paused=false，resolve 等待中的 Promise，通知监听者
 * - waitForResume(): 如果 paused 为 true，返回一个永不自动 resolve 的 Promise
 *   （只能通过 resume() 或 abortSignal.aborted 解除）
 * - ESC 中断路径会调 resume() 确保 waitForResume 不会永久阻塞
 *
 * 暂停时机：在 useConversation.ts 的 while(true) 循环中，
 * 每轮 AI 返回结果后、决定是否继续下一轮之前检查。
 */

export type PauseState = 'running' | 'paused';

export class PauseGate {
	private _paused: boolean = false;
	private listeners: Set<(state: PauseState) => void> = new Set();
	private waitResolvers: Set<() => void> = new Set();

	/** 当前是否处于暂停状态 */
	get paused(): boolean {
		return this._paused;
	}

	/** 当前状态 */
	get state(): PauseState {
		return this._paused ? 'paused' : 'running';
	}

	/** 订阅状态变化 */
	subscribe(callback: (state: PauseState) => void): () => void {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	private notify(): void {
		const state = this.state;
		for (const listener of this.listeners) {
			listener(state);
		}
	}

	/** 暂停 AI Loop */
	pause(): void {
		if (this._paused) return;
		this._paused = true;
		this.notify();
	}

	/** 继续运行 AI Loop */
	resume(): void {
		if (!this._paused) return;
		this._paused = false;
		// resolve 所有等待中的 Promise
		for (const resolver of this.waitResolvers) {
			resolver();
		}
		this.waitResolvers.clear();
		this.notify();
	}

	/**
	 * 如果当前已暂停，返回一个等待 resume() 的 Promise。
	 * 如果未暂停，立即返回。
	 * 如果 abortSignal 被触发（ESC 中断），也立即返回。
	 */
	async waitForResume(abortSignal?: AbortSignal): Promise<void> {
		if (!this._paused) return;

		return new Promise<void>(resolve => {
			const resolver = () => {
				cleanup();
				resolve();
			};

			const onAbort = () => {
				cleanup();
				resolve();
			};

			const cleanup = () => {
				this.waitResolvers.delete(resolver);
				abortSignal?.removeEventListener('abort', onAbort);
			};

			this.waitResolvers.add(resolver);

			if (abortSignal) {
				if (abortSignal.aborted) {
					cleanup();
					resolve();
					return;
				}
				abortSignal.addEventListener('abort', onAbort);
			}
		});
	}

	/** 重置状态（用于 AI 流程结束时的清理） */
	reset(): void {
		if (this._paused) {
			this.resume();
		}
	}
}

/** 全局单例 */
export const pauseGate = new PauseGate();
