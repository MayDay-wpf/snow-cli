/**
 * 内置 StatusLine 项的稳定 hook id 列表。
 *
 * 用户插件可以通过相同 id 注册外部 hook 来覆盖内置渲染：
 * 一旦同 id 的外部 hook 出现，StatusLine 组件会跳过对应的内置硬编码渲染，
 * 改由用户 hook 返回的 StatusLineRenderItem 负责显示。
 *
 * 新增内置项时，请同步在这里登记一个稳定 id，并在中英文 StatusLine 文档
 * 的「内置 Hook 列表」一节中更新说明。
 */
export const BUILTIN_STATUSLINE_IDS = {
	profile: 'builtin.profile',
	modeYolo: 'builtin.mode-yolo',
	modePlan: 'builtin.mode-plan',
	modeHunt: 'builtin.mode-hunt',
	modeTeam: 'builtin.mode-team',
	modeUltraTodo: 'builtin.mode-ultra-todo',
	toolSearch: 'builtin.tool-search',
	hybridCompress: 'builtin.hybrid-compress',
	imageCompress: 'builtin.image-compress',
	telemetry: 'builtin.telemetry',
	privacy: 'builtin.privacy',
	ideConnection: 'builtin.ide-connection',
	backendConnection: 'builtin.backend-connection',
	codebaseIndexing: 'builtin.codebase-indexing',
	watcher: 'builtin.watcher',
	fileUpdate: 'builtin.file-update',
	copyStatus: 'builtin.copy-status',
	compressBlock: 'builtin.compress-block',
	memory: 'builtin.memory',
	speedometer: 'builtin.speedometer',
	gitBranch: 'builtin.git-branch',
} as const;

export type BuiltinStatusLineId =
	(typeof BUILTIN_STATUSLINE_IDS)[keyof typeof BUILTIN_STATUSLINE_IDS];

const BUILTIN_STATUSLINE_ID_VALUES = new Set<string>(
	Object.values(BUILTIN_STATUSLINE_IDS),
);

export function isBuiltinStatusLineId(id: string): id is BuiltinStatusLineId {
	return BUILTIN_STATUSLINE_ID_VALUES.has(id);
}
