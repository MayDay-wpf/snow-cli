import type {Message} from '../../components/chat/MessageList.js';

/**
 * StaticFeed — 面向 Ink <Static> 的“单调长度”渲染投喂流。
 *
 * 背景（关键约束）：
 * Ink 的 <Static> 内部维护 index = items.length（在 useLayoutEffect 中重置），
 * 每次只渲染 items.slice(index)。因此一旦 items.length 变小，新项会落在 index
 * 之下并被永久跳过。所以传给 <Static> 的数组长度必须单调不减。
 *
 * 本类把“渲染投喂流”和“保留数据”解耦：
 *   - committedCount：已提交的消息总数，作为 view() 的 length 基准（+1 给 header）。
 *   - live：真正保留在内存里的窗口（有界）。
 *   - 裁剪只改 live 的内容，不改 committedCount，因此 <Static> 不会重渲染任何
 *     已提交项，屏幕上已打印到 scrollback 的内容也不会被重绘（无闪烁、无跳动）。
 *
 * 回滚锚点（重要）：
 *   双击 ESC 的回滚列表是从 UI messages 派生的，因此**用户消息永不裁剪**，
 *   否则裁剪后回滚列表会丢失历史锚点。只有非用户消息（助手输出、工具结果、
 *   流式行等）参与条数/字节预算裁剪。
 *
 * 索引：
 *   每条 live 记录自带绝对索引 index，渲染端据此计算并行分组边界与 React key；
 *   slice() 用二分查找定位，因此即使窗口非连续（跳过了被裁掉的消息）也正确。
 */

export type FeedItem =
	| {kind: 'header'}
	| {kind: 'message'; message: Message; index: number};

export const HEADER_ITEM: FeedItem = {kind: 'header'};

/** 保留窗口默认上限：非用户消息条数。 */
const DEFAULT_MAX_LIVE_MESSAGES = 4000;
/** 保留窗口默认上限：非用户消息字节数（约 64 MB）。 */
const DEFAULT_MAX_LIVE_BYTES = 64 * 1024 * 1024;

function readPositiveInt(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const MAX_LIVE_MESSAGES = readPositiveInt(
	process.env['SNOW_TUI_MAX_MESSAGES'],
	DEFAULT_MAX_LIVE_MESSAGES,
);

export const MAX_LIVE_BYTES = readPositiveInt(
	process.env['SNOW_TUI_MAX_BYTES'],
	DEFAULT_MAX_LIVE_BYTES,
);

/** 估算任意值的字节量（有深度上限，避免对大对象做 JSON.stringify）。 */
function estimateValueBytes(value: unknown, depth = 0): number {
	if (value === null || value === undefined || depth > 4) {
		return 0;
	}

	if (typeof value === 'string') {
		return value.length;
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return 8;
	}

	if (Array.isArray(value)) {
		let sum = 0;
		for (const item of value) {
			sum += estimateValueBytes(item, depth + 1);
		}

		return sum;
	}

	if (typeof value === 'object') {
		let sum = 0;
		for (const item of Object.values(value as Record<string, unknown>)) {
			sum += estimateValueBytes(item, depth + 1);
		}

		return sum;
	}

	return 0;
}

/** 估算单条消息占用的字节量，用于字节预算裁剪。 */
export function estimateMessageBytes(message: Message): number {
	let bytes = 0;
	bytes += message.content?.length ?? 0;
	bytes += message.toolResult?.length ?? 0;
	bytes += message.thinking?.length ?? 0;
	bytes += message.terminalResult?.stdout?.length ?? 0;
	bytes += message.terminalResult?.stderr?.length ?? 0;
	bytes += estimateValueBytes(message.toolCall?.arguments);
	bytes += estimateValueBytes(message.toolDisplay?.args);

	if (message.files) {
		for (const file of message.files) {
			bytes += file.path?.length ?? 0;
		}
	}

	if (message.images) {
		for (const image of message.images) {
			bytes += image.data?.length ?? 0;
		}
	}

	if (message.customCommandExecution?.output) {
		for (const line of message.customCommandExecution.output) {
			bytes += line?.length ?? 0;
		}
	}

	// 对象本身的开销
	return bytes + 64;
}

/**
 * 是否为回滚锚点（用户消息）。
 * 与 useHistoryNavigation.getUserMessages / useRollback.resolveSnapshotIndex
 * 的判定保持一致，否则回滚列表与序号会对不上。
 */
export function isRollbackAnchor(message: Message): boolean {
	return (
		message.role === 'user' &&
		Boolean(message.content?.trim()) &&
		!message.subAgentDirected
	);
}

function isSamePrefix(previous: Message[], next: Message[]): boolean {
	for (let i = 0; i < previous.length; i++) {
		if (previous[i] !== next[i]) {
			return false;
		}
	}

	return true;
}

type LiveEntry = {
	message: Message;
	/** 该消息在已提交序列中的绝对索引（0-based）。 */
	index: number;
	/** 预算用的字节估算值（缓存，避免重复计算）。 */
	bytes: number;
};

/** 返回第一个 index >= target 的位置（live 按 index 升序）。 */
function lowerBound(live: LiveEntry[], target: number): number {
	let low = 0;
	let high = live.length;

	while (low < high) {
		const mid = (low + high) >> 1;
		if (live[mid]!.index < target) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	return low;
}

export class StaticFeed {
	/** 已提交消息总数（不含 header），作为绝对索引基准。 */
	private committedCount = 0;
	/** 保留窗口（按绝对索引升序）。 */
	private live: LiveEntry[] = [];
	private liveBytes = 0;
	/** 非锚点消息的条数与字节数（受预算约束的部分）。 */
	private otherCount = 0;
	private otherBytes = 0;

	get committed(): number {
		return this.committedCount;
	}

	/** 当前保留的消息条数。 */
	get retainedCount(): number {
		return this.live.length;
	}

	/** 用户消息永不裁剪，因此该偏移恒为 0（保留接口兼容）。 */
	get trimmedUserMessages(): number {
		return 0;
	}

	/** 追加消息（常规路径：只增不减）。 */
	appendMessages(messages: Message[]): void {
		if (messages.length === 0) {
			return;
		}

		for (const message of messages) {
			const bytes = estimateMessageBytes(message);
			this.live.push({message, index: this.committedCount, bytes});
			this.liveBytes += bytes;
			if (!isRollbackAnchor(message)) {
				this.otherCount++;
				this.otherBytes += bytes;
			}

			this.committedCount++;
		}
	}

	/**
	 * 用新的窗口替换保留数据（压缩/回滚/会话恢复等“替换或收缩”路径）。
	 * committedCount 同步收敛到窗口长度，保证 view() 的 slice 语义正确。
	 */
	replaceWindow(messages: Message[]): void {
		this.live = [];
		this.liveBytes = 0;
		this.otherCount = 0;
		this.otherBytes = 0;

		let index = 0;
		for (const message of messages) {
			const bytes = estimateMessageBytes(message);
			this.live.push({message, index, bytes});
			this.liveBytes += bytes;
			if (!isRollbackAnchor(message)) {
				this.otherCount++;
				this.otherBytes += bytes;
			}

			index++;
		}

		this.committedCount = this.live.length;
	}

	/** 完全重置（/clear、/del-session 等清空路径）。 */
	reset(): void {
		this.committedCount = 0;
		this.live = [];
		this.liveBytes = 0;
		this.otherCount = 0;
		this.otherBytes = 0;
	}

	/**
	 * 从头部裁剪已进入 scrollback 的消息。
	 * 用户消息（回滚锚点）永不裁剪；其余消息受 maxLive / maxBytes 约束。
	 * 不改变 committedCount，因此不会触发 <Static> 重渲染。
	 */
	trim(maxLive: number, maxBytes: number): void {
		if (this.otherCount <= maxLive && this.otherBytes <= maxBytes) {
			return;
		}

		const total = this.live.length;
		const kept: LiveEntry[] = [];
		let keptOthers = 0;
		let keptOtherBytes = 0;
		let keptBytes = 0;

		// 从尾部（最新）往前保留：锚点无条件保留，其余按预算保留。
		for (let i = total - 1; i >= 0; i--) {
			const entry = this.live[i]!;
			if (isRollbackAnchor(entry.message)) {
				kept.push(entry);
				keptBytes += entry.bytes;
				continue;
			}

			if (keptOthers < maxLive && keptOtherBytes < maxBytes) {
				kept.push(entry);
				keptOthers++;
				keptOtherBytes += entry.bytes;
				keptBytes += entry.bytes;
			}
		}

		kept.reverse();

		this.live = kept;
		this.liveBytes = keptBytes;
		this.otherCount = keptOthers;
		this.otherBytes = keptOtherBytes;
	}

	/** 当前保留窗口的消息数组（新数组，供 React state 使用）。 */
	liveMessages(): Message[] {
		return this.live.map(entry => entry.message);
	}

	/**
	 * 供 <Static items={...}> 使用的数组视图。
	 * length = committedCount + 1（含 header），单调不减；
	 * 正常渲染路径下 slice(index) 为 O(log n)。
	 */
	view(): FeedItem[] {
		const committed = this.committedCount;
		const live = this.live;

		return {
			length: committed + 1,
			slice(start: number): FeedItem[] {
				// header 位于视图索引 0；重挂载时 index 归零，会一次性返回整窗。
				if (start <= 0) {
					const out: FeedItem[] = [HEADER_ITEM];
					for (const entry of live) {
						out.push({
							kind: 'message',
							message: entry.message,
							index: entry.index,
						});
					}

					return out;
				}

				// 视图索引 k（k>=1）对应绝对索引 k-1。
				const offset = lowerBound(live, start - 1);
				if (offset >= live.length) {
					return [];
				}

				const out: FeedItem[] = [];
				for (let i = offset; i < live.length; i++) {
					const entry = live[i]!;
					out.push({
						kind: 'message',
						message: entry.message,
						index: entry.index,
					});
				}

				return out;
			},
		} as unknown as FeedItem[];
	}

	/** 单个索引的并行分组边界，等价于 computeParallelGroupEdges 的单点版本。 */
	parallelEdgesAt(index: number): {
		isFirstInGroup: boolean;
		isLastInGroup: boolean;
	} {
		const i = lowerBound(this.live, index);
		const entry = this.live[i];
		if (!entry || entry.index !== index) {
			return {isFirstInGroup: false, isLastInGroup: false};
		}

		const message = entry.message;
		const isInParallelGroup =
			message.parallelGroup !== undefined && message.parallelGroup !== null;
		const isTimeConsumingTool =
			message.toolPending || message.messageStatus === 'pending';

		if (!(isInParallelGroup && !isTimeConsumingTool)) {
			return {isFirstInGroup: false, isLastInGroup: false};
		}

		const prev = this.live[i - 1]?.message;
		const isFirstInGroup =
			!prev ||
			prev.parallelGroup !== message.parallelGroup ||
			Boolean(prev.toolPending) ||
			prev.messageStatus === 'pending';

		const next = this.live[i + 1]?.message;
		const nextInSameGroup =
			Boolean(next) &&
			next!.parallelGroup !== undefined &&
			next!.parallelGroup !== null &&
			next!.parallelGroup === message.parallelGroup;

		return {isFirstInGroup, isLastInGroup: !nextInSameGroup};
	}
}

/**
 * 判断一次 setMessages 更新是否为“尾部追加”。
 * 只有纯追加才走 appendMessages，其余一律替换窗口，避免破坏单调长度语义。
 */
export function isAppendUpdate(previous: Message[], next: Message[]): boolean {
	return next.length > previous.length && isSamePrefix(previous, next);
}
