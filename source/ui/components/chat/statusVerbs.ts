/**
 * Issue #215：运行期常驻动画指示的形态定义。
 *
 * - SNOWFLAKE_FRAMES：把原来静态双色闪烁的 ❆ 升级为多帧雪花动画，
 *   保留品牌符号的同时获得「活物感」。
 * - pickVerb：按 elapsed 轮换动词词库（参考 Claude Code 词条制），
 *   词条本身由 i18n 提供，支持主题化 / 用户扩展。
 *
 * 注意：本文件保持纯逻辑、无 React 依赖，方便单测与复用。
 */

/** 运行期 busy 态分类，用于选择动词词库与颜色。 */
export type BusyKind =
	| 'idle'
	| 'thinking'
	| 'deepThinking'
	| 'writing'
	| 'compressing'
	| 'terminal'
	| 'customCommand'
	| 'background'
	| 'scheduler'
	| 'saving'
	| 'stopping';

/** 参与渲染的 busy 态（排除 idle）。 */
export type ActiveBusyKind = Exclude<BusyKind, 'idle'>;

/**
 * 多帧雪花动画字符集。
 * 全部为单列宽字符，避免不同帧之间宽度抖动导致重排。
 */
export const SNOWFLAKE_FRAMES = [
	'❆',
	'❅',
	'✻',
	'✼',
	'❋',
	'✽',
	'❊',
	'✸',
] as const;

/** 雪花多帧动画的刷新间隔（毫秒）。 */
export const SNOWFLAKE_FRAME_INTERVAL_MS = 150;

/** 动词词库轮换节奏（秒），与 Claude Code 的观感一致。 */
export const VERB_ROTATE_SECONDS = 4;

/** 按动画帧号取雪花字符（取模，支持任意递增帧）。 */
export function pickSnowflakeFrame(frame: number): string {
	const index = Math.trunc(Math.abs(frame)) % SNOWFLAKE_FRAMES.length;
	return SNOWFLAKE_FRAMES[index] ?? SNOWFLAKE_FRAMES[0];
}

/**
 * 按 elapsed 秒数从词库中轮换取词。
 * 词库为空时返回 null，交由调用方回退到基础文案。
 */
export function pickVerb(
	verbs: readonly string[] | undefined,
	elapsedSeconds: number,
): string | null {
	if (!verbs || verbs.length === 0) {
		return null;
	}

	const safeElapsed = Number.isFinite(elapsedSeconds)
		? Math.max(0, elapsedSeconds)
		: 0;
	const index = Math.floor(safeElapsed / VERB_ROTATE_SECONDS) % verbs.length;
	return verbs[index] ?? verbs[0] ?? null;
}
