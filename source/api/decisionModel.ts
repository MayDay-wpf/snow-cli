import {addProxyToFetchOptions} from '../utils/core/proxyUtils.js';
import {getVersionHeader} from '../utils/core/version.js';
import {normalizeBaseUrlValue} from './endpointResolver.js';
import type {BaseUrlMode} from '../utils/config/apiConfig.js';
import type {DecisionModelItem} from '../utils/config/decisionModelsConfig.js';

/**
 * 决策模型（TypeSafe System One / Jev）客户端，供 codebase agent review 使用。
 *
 * 决策模型不是文本生成模型：它把一段 `state` 与一组带类型的问题一起提交，
 * 逐题作答并返回置信度。这里用它回答「这条搜索结果是否与搜索词相关」的
 * choice 问题，它的判定本身就是审查结论，不需要再让 LLM 复核一遍。
 *
 * 设计约束（参考 https://docs.typesafe.ai/api）：
 * - state 加最长问题必须落在模型的上下文内，因此 state 按字符预算硬裁剪；
 *   放不下的结果一律保留为「相关」，而不是被静默丢弃。
 * - 决策模型无法改写搜索词。它的判定触发重新检索时，改写搜索词这一件事
 *   由调用方交给 LLM 完成，失败则保留决策模型的判定结果。
 * - 任何传输/协议失败都会抛出错误，交由调用方回退到 LLM 审查，本模块
 *   自身绝不降级搜索结果。
 */

/** 官方 TypeSafe 端点；决策模型未填写 baseUrl 时使用。 */
const DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1';

/** 单次请求最多转成问题的结果数量。 */
const MAX_QUESTIONS = 40;

/** 每条结果正文最多截取的字符数。 */
const MAX_EXCERPT_CHARS = 800;

/** 整个 state（query + 所有摘要）的字符预算，避开决策模型的上下文上限。 */
const MAX_STATE_CHARS = 40_000;

/** 请求超时（毫秒）：决策模型通常在几十毫秒内返回，短超时可避免拖慢搜索。 */
const REQUEST_TIMEOUT_MS = 30_000;

/** 判定为「相关」的选项值；另一个选项固定为 irrelevant。 */
const RELEVANT_OPTION = 'relevant';

/** 敏感命令判定：允许命令在无需用户确认的情况下执行。 */
const ALLOW_OPTION = 'allow';

/** 敏感命令判定：命令需要用户先确认。 */
const DENY_OPTION = 'deny';

/** 敏感命令请求的问题 id；答案以相同键返回。 */
const VERDICT_QUESTION_ID = 'verdict';
const REASON_QUESTION_ID = 'reason';

/** 答案缺失或选项未知时使用的兜底原因分类。 */
const REASON_UNKNOWN = 'unclear';

/**
 * 敏感命令判定的原因分类。键是稳定的——由前端本地化
 * （`sensitiveCommand.decision.reason.<key>`），模型永远不写面向用户的文本。
 */
export const SENSITIVE_COMMAND_REASON_CATEGORIES: ReadonlyArray<
	readonly [string, string]
> = [
	[
		'readOnly',
		'Only reads information; files, system state and remote state stay untouched',
	],
	[
		'regenerable',
		'Touches only generated or regenerable artifacts (build output, caches, temporary files, dependencies)',
	],
	[
		'scopedChange',
		'Changes stay inside the working directory and can be undone (edit, rename, move)',
	],
	['dataLoss', 'Deletes or overwrites data that cannot be recovered'],
	[
		'systemState',
		'Changes system or environment state (permissions, packages, services, processes)',
	],
	[
		'externalEffect',
		'Publishes or sends data outside this machine (git push, upload, network write)',
	],
	[REASON_UNKNOWN, 'The target or the blast radius of the command is unclear'],
];

/** 敏感命令判定的结果。 */
export interface SensitiveCommandDecision {
	/** 是否允许命令在无需用户确认的情况下执行。 */
	allow: boolean;
	/** 原因分类键（SENSITIVE_COMMAND_REASON_CATEGORIES 之一），由前端本地化。 */
	reason: string;
	/** 模型对判定的置信度（0-1）。 */
	confidence: number;
}

/** 一条命令的判定上下文：命令文本 + 说明 + 实际执行目录 + 命中的敏感规则。 */
export interface SensitiveCommandDecisionContext {
	/** 完整命令文本。 */
	command: string;
	/** 模型为命令写的一行说明（terminal-execute 的 description）。 */
	description?: string;
	/** 命令的实际执行目录。 */
	workingDirectory?: string;
	/** 命中的敏感规则（模式 + 说明），仅作为「被规则命中」的证据，本身不构成风险。 */
	matchedRules?: Array<{pattern: string; description: string}>;
}

/** 决策模型的请求配置（baseUrl / apiKey / model）。 */
export interface DecisionModelReviewConfig {
	baseUrl: string;
	baseUrlMode: BaseUrlMode;
	apiKey: string;
	model: string;
}

/** 参与审查的一条搜索结果（只用到判定所需的字段）。 */
export interface DecisionModelReviewResult {
	filePath: string;
	startLine: number;
	endLine: number;
	content: string;
	similarityScore?: string;
}

/**
 * 把一条决策模型配置解析为可用的请求配置。
 *
 * 未选中、或缺少 API Key / model 时返回 undefined —— 调用方随即继续使用
 * LLM 审查路径，不影响搜索本身。
 */
export function resolveDecisionModelReviewConfig(
	item: DecisionModelItem | undefined,
): DecisionModelReviewConfig | undefined {
	if (!item) {
		return undefined;
	}

	const apiKey = item.apiKey.trim();
	const model = item.model.trim();
	if (!apiKey || !model) {
		return undefined;
	}

	return {
		baseUrl: item.baseUrl,
		baseUrlMode: item.baseUrlMode,
		apiKey,
		model,
	};
}

/**
 * 解析 System One 评估端点。
 *
 * - 空 baseUrl → 官方端点 `/v1/systemone`
 * - `endpoint` 模式 → 视为完整端点直接使用
 * - 已以 `/systemone` 结尾 → 原样使用
 * - 已以 `/v1` 结尾 → 追加 `/systemone`
 * - 其它 → 追加 `/v1/systemone`
 */
export function resolveSystemOneEndpoint(
	baseUrl: string,
	mode: BaseUrlMode = 'auto',
): string {
	const normalized = normalizeBaseUrlValue(baseUrl);

	if (!normalized) {
		return `${DEFAULT_BASE_URL}/systemone`;
	}

	if (mode === 'endpoint') {
		return normalized;
	}

	if (normalized.endsWith('/systemone')) {
		return normalized;
	}

	if (normalized.endsWith('/v1')) {
		return `${normalized}/systemone`;
	}

	return `${normalized}/v1/systemone`;
}

/**
 * 让决策模型逐条判定搜索结果是否与搜索词相关，返回保留结果的原始下标
 * （0 基，升序）。
 *
 * 判定规则：
 * - 每条被提问的结果都是一个 `relevant` / `irrelevant` 的 choice 问题，
 *   模型选中的选项即结论。
 * - 答案缺失（模型没回答、或回答格式异常）时保守保留该结果。
 * - 因 question 上限或 state 预算未被提问的结果同样保留：审查绝不能删除
 *   它没有判定过的结果。
 */
export async function evaluateRelevance(
	config: DecisionModelReviewConfig,
	query: string,
	results: DecisionModelReviewResult[],
	abortSignal?: AbortSignal,
): Promise<number[]> {
	if (results.length === 0) {
		return [];
	}

	const {state, asked} = buildState(query, results);

	// state 预算放不下任何结果：与其发送一个只拿 query 做判断的空请求，
	// 不如直接报告全部相关。
	if (asked.length === 0) {
		return results.map((_, index) => index);
	}

	const questions: Record<string, unknown> = {};
	for (const {id} of asked) {
		questions[id] = {
			type: 'choice',
			instructions: `Is result [${id}] relevant to the developer's code search query?`,
			criteria: {
				[RELEVANT_OPTION]: 'The excerpt matches what the query is looking for',
				irrelevant:
					'An unrelated file, or generic boilerplate that only looks similar',
			},
		};
	}

	const parsed = await postEvaluation(
		config,
		{state, model: config.model, questions},
		abortSignal,
	);

	const answers =
		parsed && typeof parsed === 'object'
			? (parsed as {answers?: Record<string, unknown>}).answers ?? {}
			: {};

	const askedIndices = new Set<number>();
	const relevant: number[] = [];

	for (const {index, id} of asked) {
		askedIndices.add(index);

		const answer = answers[id];
		const verdict =
			answer && typeof answer === 'object'
				? (answer as {choice?: unknown}).choice
				: undefined;

		// 决策模型的判定即结论：`relevant` 保留，其它选项一律视为不相关；
		// 缺失答案时保守保留，绝不删除无法判定的结果。
		if (
			verdict === undefined ||
			verdict === null ||
			verdict === RELEVANT_OPTION
		) {
			relevant.push(index);
		}
	}

	// 未被提问的结果（question 上限 / state 预算）一律保留。
	for (let index = 0; index < results.length; index++) {
		if (!askedIndices.has(index)) {
			relevant.push(index);
		}
	}

	relevant.sort((a, b) => a - b);
	return relevant;
}

/**
 * 让决策模型判定一条命中敏感规则的命令是否可以在无需用户确认的情况下执行，
 * 以及原因分类。
 *
 * 判定是模型自己在 `allow` / `deny` 之间的 choice，依据是命令在其工作目录里的
 * 真实效果——命中的规则只是提示，从不作为结论（规则也会因为文件名、参数、
 * commit message 而命中）。第二个问题从固定的原因分类里选一个，调用方据此用
 * 用户的语言解释判定。两个答案在同一次请求里返回。缺失 verdict 会抛出错误：
 * 调用方随即保留普通确认提示，绝不基于猜测放行。
 */
export async function evaluateSensitiveCommand(
	config: DecisionModelReviewConfig,
	context: SensitiveCommandDecisionContext,
	abortSignal?: AbortSignal,
): Promise<SensitiveCommandDecision> {
	const state: Record<string, unknown> = {command: context.command};

	const description = (context.description ?? '').trim();
	if (description) {
		state['description'] = description;
	}

	const workingDirectory = (context.workingDirectory ?? '').trim();
	if (workingDirectory) {
		state['workingDirectory'] = workingDirectory;
	}

	state['platform'] = process.platform;
	state['matchedRules'] = (context.matchedRules ?? []).map(rule => ({
		pattern: rule.pattern,
		description: rule.description,
	}));

	const reasonCriteria: Record<string, string> = {};
	for (const [key, description] of SENSITIVE_COMMAND_REASON_CATEGORIES) {
		reasonCriteria[key] = description;
	}

	const questions = {
		[VERDICT_QUESTION_ID]: {
			type: 'choice',
			instructions:
				"Judging the real effect of this exact command in this working directory, does it have to wait for the user's confirmation before it runs?",
			criteria: {
				[ALLOW_OPTION]:
					'Low risk — it can run unattended. It only reads, or it touches generated or regenerable artifacts (build output, caches, temporary files, package or dependency directories), or its effect stays inside the working directory and is easy to undo. A matched rule is not a risk by itself: rules also fire on file names, arguments and commit messages. Typical cases: inspecting files, builds, tests, formatting, cleaning build output, installing dependencies, git status/diff/add/commit inside the project.',
				[DENY_OPTION]:
					'Real risk of an effect the user did not ask for and could not easily undo: deleting or overwriting source code, documents, databases or paths outside the working directory; wiping data that cannot be regenerated; changing system or environment state (permissions, packages, services, processes); publishing or sending data off this machine; or the target is unknown so the effect cannot be bounded. Typical cases: recursive deletion of unresolved paths, disk formatting, force push, dropping a database, piping local files to a remote host.',
			},
		},
		[REASON_QUESTION_ID]: {
			type: 'choice',
			instructions: "Which of these best describes the command's effect?",
			criteria: reasonCriteria,
		},
	};

	const parsed = await postEvaluation(
		config,
		{state, model: config.model, questions},
		abortSignal,
	);

	const answers =
		parsed && typeof parsed === 'object'
			? (parsed as {answers?: Record<string, unknown>}).answers ?? {}
			: {};

	const verdictAnswer = answers[VERDICT_QUESTION_ID];
	const verdict =
		verdictAnswer && typeof verdictAnswer === 'object'
			? (verdictAnswer as {choice?: unknown}).choice
			: undefined;

	if (typeof verdict !== 'string') {
		throw new Error(
			'Decision model did not answer the sensitive command verdict',
		);
	}

	// 未知或缺失的原因分类降级为 unclear：判定本身仍然成立，只是解释不够具体。
	const rawReason =
		answers[REASON_QUESTION_ID] &&
		typeof answers[REASON_QUESTION_ID] === 'object'
			? ((answers[REASON_QUESTION_ID] as {choice?: unknown}).choice as
					| unknown
					| undefined)
			: undefined;
	const reason =
		typeof rawReason === 'string' &&
		SENSITIVE_COMMAND_REASON_CATEGORIES.some(([key]) => key === rawReason)
			? rawReason
			: REASON_UNKNOWN;

	const confidence =
		verdictAnswer && typeof verdictAnswer === 'object'
			? (verdictAnswer as {confidence?: unknown}).confidence
			: undefined;

	return {
		// 除显式的 allow 外，一律保留确认提示。
		allow: verdict === ALLOW_OPTION,
		reason,
		confidence:
			typeof confidence === 'number' && Number.isFinite(confidence)
				? Math.min(1, Math.max(0, confidence))
				: 0,
	};
}

/**
 * 构建评估 state，并返回落在预算内的 `(结果下标, 问题 id)` 列表。
 */
function buildState(
	query: string,
	results: DecisionModelReviewResult[],
): {state: unknown; asked: Array<{index: number; id: string}>} {
	const items: Array<Record<string, unknown>> = [];
	const asked: Array<{index: number; id: string}> = [];
	let usedChars = query.length;

	for (let index = 0; index < results.length; index++) {
		if (asked.length >= MAX_QUESTIONS) {
			break;
		}

		const result = results[index]!;
		const excerpt = result.content.slice(0, MAX_EXCERPT_CHARS);
		// 路径、行号区间、id 以及外围 JSON 键也会占用预算，用一个小常量近似。
		const cost = excerpt.length + result.filePath.length + 96;
		if (usedChars + cost > MAX_STATE_CHARS) {
			break;
		}
		usedChars += cost;

		const id = `result_${index + 1}`;
		items.push({
			id,
			file: result.filePath,
			lines: `${result.startLine}-${result.endLine}`,
			excerpt,
		});
		asked.push({index, id});
	}

	return {state: {query, results: items}, asked};
}

/**
 * 发送一次评估请求并返回解析后的响应体。
 *
 * 任何失败（传输、HTTP 状态、响应体非 JSON）都会抛出错误，交由调用方决定
 * 回退策略。
 */
async function postEvaluation(
	config: DecisionModelReviewConfig,
	body: unknown,
	abortSignal?: AbortSignal,
): Promise<unknown> {
	const endpoint = resolveSystemOneEndpoint(config.baseUrl, config.baseUrlMode);

	// fetch 无法同时接收「超时」与「外部取消」两个信号，这里用同一个
	// AbortController 承载两者。
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const forwardAbort = () => controller.abort();

	if (abortSignal) {
		if (abortSignal.aborted) {
			controller.abort();
		} else {
			abortSignal.addEventListener('abort', forwardAbort, {once: true});
		}
	}

	try {
		const fetchOptions = addProxyToFetchOptions(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				'x-snow': getVersionHeader(),
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		const response = await fetch(endpoint, fetchOptions);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Decision model API error (${response.status}): ${errorText.slice(
					0,
					500,
				)}`,
			);
		}

		return await response.json();
	} finally {
		clearTimeout(timer);
		if (abortSignal) {
			abortSignal.removeEventListener('abort', forwardAbort);
		}
	}
}
