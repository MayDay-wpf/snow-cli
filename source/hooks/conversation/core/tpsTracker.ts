/**
 * TPS (Tokens Per Second) Tracker
 *
 * 实时测速仪核心模块。通过按"秒"分桶的方式统计 token 输出速率。
 *
 * 工作原理：
 * - 每次流式输出到达时调用 recordTokens() 记录当前时间戳对应的 token 数量增量
 * - 内部维护一个定时器（每秒触发），计算"上一秒"的 TPS 值
 * - 如果某一秒内没有任何 token 输出，TPS 会归零（而不是停留在最后一个速度值上）
 * - 通过 subscribe / getSnapshot 模式与 React 的 useSyncExternalStore 兼容
 *
 * 生命周期：
 * - /speedometer 命令开启时调用 start()
 * - /speedometer 命令关闭时调用 stop()
 * - start() 会自动清理之前的计时器，stop() 会清空数据
 */

/** TPS 快照，供 React useSyncExternalStore 消费 */
export interface TpsSnapshot {
	/** 当前实时 TPS（每秒 token 数），无输出时为 0 */
	tps: number;
	/** 峰值 TPS */
	peakTps: number;
}

type Listener = () => void;

const TICK_INTERVAL_MS = 1000;

class TpsTracker {
	/** 是否已启用测速仪 */
	private active = false;

	/** 每秒触发的计时器 */
	private tickTimer: ReturnType<typeof setInterval> | null = null;

	/** 订阅者列表 */
	private listeners: Set<Listener> = new Set();

	/** 当前快照（不可变，每次更新生成新对象引用以确保 useSyncExternalStore 检测到变化） */
	private snapshot: TpsSnapshot = {
		tps: 0,
		peakTps: 0,
	};

	/**
	 * Token 分桶记录。
	 * key = 秒级时间戳（Math.floor(Date.now() / 1000)）
	 * value = 该秒内累计的 token 数
	 *
	 * 设计为 Map 而非数组：流式 chunk 到达频率不固定，
	 * 用秒级时间戳做 key 可以 O(1) 写入并在 tick 时清理过期桶。
	 */
	private tokenBuckets: Map<number, number> = new Map();

	/** 当前正在累积的秒级时间戳 */
	private currentSecond: number = 0;

	/** 当前秒内累计的 token 数（与 tokenBuckets[currentSecond] 同步） */
	private currentSecondTokens: number = 0;

	/** 当前快照对象引用（用于 getSnapshot 返回，确保引用稳定性） */
	private snapshotRef: TpsSnapshot = this.snapshot;

	// ─────────────────────────── 公共 API ───────────────────────────

	/**
	 * 启用测速仪
	 */
	start(): void {
		if (this.active) {
			return;
		}
		this.active = true;
		this.resetInternal();
		this.startTicking();
		this.emitChange();
	}

	/**
	 * 停用测速仪
	 */
	stop(): void {
		if (!this.active) {
			return;
		}
		this.active = false;
		this.stopTicking();
		this.resetInternal();
		this.emitChange();
	}

	/**
	 * 是否已启用
	 */
	isActive(): boolean {
		return this.active;
	}

	/**
	 * 记录 token 输出增量（由 streamProcessor.countTokens 调用）
	 * @param tokenCount 本次新增的 token 数量
	 */
	recordTokens(tokenCount: number): void {
		if (!this.active || tokenCount <= 0) {
			return;
		}

		const now = Date.now();
		const second = Math.floor(now / 1000);

		// 如果进入了新的秒，将前一秒的累积值写入 buckets
		if (this.currentSecond !== 0 && this.currentSecond !== second) {
			if (this.currentSecondTokens > 0) {
				this.tokenBuckets.set(this.currentSecond, this.currentSecondTokens);
			}
			this.currentSecond = second;
			this.currentSecondTokens = 0;
		}

		if (this.currentSecond === 0) {
			this.currentSecond = second;
		}

		this.currentSecondTokens += tokenCount;
		// 同步写入 buckets，确保 tick 时能读到
		this.tokenBuckets.set(second, this.currentSecondTokens);
	}

	/**
	 * 重置当前流式会话的统计（不改变 active 状态）
	 * 在新的流式会话开始时应调用。
	 */
	resetSession(): void {
		if (!this.active) {
			return;
		}
		this.resetInternal();
		this.emitChange();
	}

	// ─────────────────────── useSyncExternalStore 兼容接口 ───────────────────────

	/**
	 * 订阅 TPS 变化
	 * @returns 取消订阅函数
	 */
	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/**
	 * 获取当前快照（必须返回稳定的引用，仅在值变化时才返回新对象）
	 */
	getSnapshot = (): TpsSnapshot => {
		return this.snapshotRef;
	};

	// ─────────────────────────── 内部实现 ───────────────────────────

	private resetInternal(): void {
		this.tokenBuckets.clear();
		this.currentSecond = 0;
		this.currentSecondTokens = 0;
		this.snapshot = {
			tps: 0,
			peakTps: 0,
		};
		this.snapshotRef = this.snapshot;
	}

	private startTicking(): void {
		this.stopTicking();
		this.tickTimer = setInterval(() => {
			this.tick();
		}, TICK_INTERVAL_MS);
	}

	private stopTicking(): void {
		if (this.tickTimer) {
			clearInterval(this.tickTimer);
			this.tickTimer = null;
		}
	}

	/**
	 * 每秒 tick：计算上一秒的 TPS 并更新快照
	 */
	private tick(): void {
		if (!this.active) {
			return;
		}

		const now = Date.now();
		const currentSec = Math.floor(now / 1000);

		// 计算当前实时 TPS：
		// 取 currentSecondTokens（当前秒正在累积的 token 数）
		// 如果当前秒还没有结束，这个值是部分累积，但作为实时显示已经足够
		// 如果某一秒没有任何 token 输出，currentSecondTokens 会是 0，TPS 归零
		const tps = this.currentSecondTokens;

		// 峰值 TPS
		const peakTps = Math.max(this.snapshot.peakTps, tps);

		// 如果进入新的秒，重置当前秒的累积（这确保下一秒从 0 开始）
		// 如果当前秒的时间戳已经改变，说明我们已经跨秒了
		if (this.currentSecond !== 0 && this.currentSecond !== currentSec) {
			this.currentSecond = currentSec;
			this.currentSecondTokens = 0;
			this.tokenBuckets.set(currentSec, 0);
		}

		// 清理超过 10 秒的旧桶，避免内存泄漏
		const cutoff = currentSec - 10;
		for (const key of this.tokenBuckets.keys()) {
			if (key < cutoff) {
				this.tokenBuckets.delete(key);
			}
		}

		// 生成新快照（新引用以确保 useSyncExternalStore 检测到变化）
		this.snapshot = {
			tps,
			peakTps,
		};
		this.snapshotRef = this.snapshot;

		this.emitChange();
	}

	private emitChange(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}

// 导出全局单例
export const tpsTracker = new TpsTracker();

// ────────────────── React useSyncExternalStore 适配 ──────────────────

/**
 * 订阅 TPS 变化的 React hook 适配函数
 */
export const subscribeTpsTracker = (listener: Listener): (() => void) =>
	tpsTracker.subscribe(listener);

/**
 * 获取 TPS 快照的 React hook 适配函数
 */
export const getTpsTrackerSnapshot = (): TpsSnapshot =>
	tpsTracker.getSnapshot();
