/**
 * 流式读取保护工具
 * 提供空闲超时检测和断开后消息丢弃机制
 * 每次重试必须创建新的 guard 实例,禁止跨重试共享状态
 */

import {logger} from './logger.js';

const log = logger.child('core:streamGuards');

/**
 * 流式读取空闲超时默认常量(3分钟)
 * 作为兜底值使用,调用方可通过 createIdleTimeoutGuard 传入 idleTimeoutMs 覆盖
 */
export const STREAM_IDLE_TIMEOUT_MS = 180000;

/**
 * 流空闲超时错误
 * 当流在指定时间内未收到任何数据时抛出
 * 错误消息包含 [RETRIABLE] 和 idle timeout 关键字,便于 isRetriableError 识别
 */
export class StreamIdleTimeoutError extends Error {
	override name = 'StreamIdleTimeoutError';

	constructor(
		message: string,
		public readonly idleMs: number = STREAM_IDLE_TIMEOUT_MS,
	) {
		// 包含 [RETRIABLE] 标记和 idle timeout 关键字,确保被识别为可重试错误和流中断
		super(`[API_ERROR] [RETRIABLE] Stream idle timeout: ${message}`);
	}
}

/**
 * 流读取保护器接口
 */
export interface StreamGuard {
	/**
	 * 标记当前流为已丢弃状态
	 * 调用后,后续从该流读取的消息将被丢弃
	 */
	abandon: () => void;

	/**
	 * 检查当前流是否已被丢弃
	 */
	isAbandoned: () => boolean;

	/**
	 * 获取超时错误(如有)
	 * 在读取循环中检查并抛出,确保异常被正确的 try/catch 捕获
	 */
	getTimeoutError: () => Error | null;

	/**
	 * 更新最后活动时间
	 * 每次收到数据时调用,重置空闲计时器
	 */
	touch: () => void;

	/**
	 * 清理资源
	 * 正常结束时调用,清除计时器
	 */
	dispose: () => void;
}

/**
 * 创建流读取保护器
 * 提供空闲超时检测和断开后消息丢弃功能
 *
 * @param reader - 可取消的 reader,用于断开时清理
 * @param onTimeout - 超时回调(可选).允许在回调中 throw,但异常会被 guard 捕获并保存,调用方需在读取循环中通过 getTimeoutError() 取出并在循环上下文 throw,以进入业务 try/catch 和重试链路
 * @returns StreamGuard 实例
 *
 * 使用示例:
 * ```typescript
 * const guard = createIdleTimeoutGuard({
 *   reader,
 *   onTimeout: () => {
 *     throw new StreamIdleTimeoutError('No data for 3min');
 *   },
 * });
 *
 * try {
 *   while (true) {
 *     const {done, value} = await reader.read();
 *     guard.touch();
 *
 *     const timeoutError = guard.getTimeoutError();
 *     if (timeoutError) throw timeoutError;
 *
 *     if (guard.isAbandoned()) continue;
 *     if (done) break;
 *
 *     yield value;
 *   }
 * } finally {
 *   guard.dispose();
 * }
 * ```
 */
export function createIdleTimeoutGuard({
	reader,
	onTimeout,
	idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
}: {
	reader?: ReadableStreamDefaultReader<any>;
	onTimeout?: () => void;
	idleTimeoutMs?: number;
}): StreamGuard {
	let isAbandoned = false;
	let lastChunkTime = Date.now();
	let idleTimer: ReturnType<typeof setInterval> | null = null;
	let timeoutError: Error | null = null;

	// 启动空闲检测定时器(每5秒检查一次)
	idleTimer = setInterval(() => {
		try {
			if (isAbandoned) return;

			if (Date.now() - lastChunkTime <= idleTimeoutMs) return;

			// 触发超时
			isAbandoned = true;

			// 即使调用方未提供 onTimeout,也要设置默认超时错误,避免超时后静默结束
			if (!timeoutError) {
				timeoutError = new StreamIdleTimeoutError(
					`No data received for ${idleTimeoutMs}ms`,
					idleTimeoutMs,
				);
			}

			// 尝试取消 reader 以减少延迟消息(同步/异步异常都应吞掉)
			try {
				reader?.cancel().catch((err: unknown) => {
					// 忽略取消失败
					log.debug('streamGuards reader.cancel async rejection ignored', {error: err});
				});
			} catch (error) {
				// 忽略取消失败
				log.debug('streamGuards reader.cancel sync error ignored', {error});
			}

			// 日志写入可能同步抛错,必须捕获,避免定时器回调触发 uncaughtException
			try {
				log.warn(`Stream idle timeout detected after ${idleTimeoutMs}ms`);
			} catch (error) {
				// 忽略日志写入失败，避免死循环
				void error;
			}

			// 允许调用方在超时时构造更具体的错误,但必须捕获并通过 getTimeoutError 传递
			if (onTimeout) {
				try {
					onTimeout();
				} catch (error) {
					timeoutError =
						error instanceof Error ? error : new Error(String(error));
				}
			}
		} catch (error) {
			// 定时器回调中禁止异常冒泡到事件循环
			isAbandoned = true;
			if (!timeoutError) {
				timeoutError =
					error instanceof Error ? error : new Error(String(error));
			}
			try {
				reader?.cancel().catch((err: unknown) => {
					// 忽略取消失败
					log.debug('streamGuards reader.cancel async rejection in catch block ignored', {error: err});
				});
			} catch (cancelError) {
				// 忽略取消失败
				log.debug('streamGuards reader.cancel sync error in catch block ignored', {error: cancelError});
			}
		}
	}, Math.min(5000, Math.max(10, Math.floor(idleTimeoutMs / 2))));

	return {
		abandon: () => {
			isAbandoned = true;
			try {
				reader?.cancel().catch((err: unknown) => {
					// 忽略取消失败
					log.debug('streamGuards abandon reader.cancel async rejection ignored', {error: err});
				});
			} catch (error) {
				// 忽略取消失败
				log.debug('streamGuards abandon reader.cancel sync error ignored', {error});
			}
		},

		isAbandoned: () => isAbandoned,

		// 检查是否有超时错误需要抛出,在读取循环中调用以确保异常被正确捕获
		getTimeoutError: () => timeoutError,

		touch: () => {
			lastChunkTime = Date.now();
		},

		dispose: () => {
			if (idleTimer) {
				clearInterval(idleTimer);
				idleTimer = null;
			}
		},
	};
}
