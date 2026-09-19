import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {
	resolveSnowConfigDir,
	normalizeBaseUrlMode,
	type BaseUrlMode,
} from './apiConfig.js';

/**
 * 单个决策模型（Decision Model，例如 TypeSafe Jev）配置项。
 *
 * 决策模型与 snowcfg 中的 LLM 配置完全独立：它面向高频结构化决策
 * （是/否判断、多选分类、量表打分），不生成文本，因此不归属于任何 LLM 模型。
 * 同一个配置文件内可同时存在多个决策模型，其中最多一个为「激活」状态。
 *
 * 注意：决策模型有自己的请求体（state + 类型化问题 → 带置信度的结构化答案），
 * 不复用 LLM 的请求方案（chat / responses / gemini / anthropic），因此这里没有该字段。
 */
export interface DecisionModelItem {
	id: string;
	name: string;
	baseUrl: string;
	baseUrlMode: BaseUrlMode;
	apiKey: string;
	/** 决策模型 ID，例如 typesafe/jev-1.13 */
	model: string;
	createdAt: string;
}

export interface DecisionModelsConfig {
	/** 当前激活项 ID；'' 表示未激活（不启用决策模型） */
	active: string;
	models: DecisionModelItem[];
}

const CONFIG_DIR = resolveSnowConfigDir();
const DECISION_MODELS_FILE = join(CONFIG_DIR, 'decision-models.json');

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

function normalizeItem(raw: unknown): DecisionModelItem | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}

	const item = raw as Partial<DecisionModelItem>;
	const id = typeof item.id === 'string' ? item.id : '';
	if (!id) {
		return null;
	}

	return {
		id,
		name: typeof item.name === 'string' ? item.name : '',
		baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl : '',
		baseUrlMode: normalizeBaseUrlMode(item.baseUrlMode),
		apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
		model: typeof item.model === 'string' ? item.model : '',
		createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
	};
}

/**
 * 读取决策模型配置。
 * 文件不存在、内容为空或非法时返回 null，由调用方决定回退行为。
 */
export function getDecisionModelsConfig(): DecisionModelsConfig | null {
	ensureConfigDirectory();

	if (!existsSync(DECISION_MODELS_FILE)) {
		return null;
	}

	try {
		const content = readFileSync(DECISION_MODELS_FILE, 'utf8');
		if (content.trim().length === 0) {
			return null;
		}

		const data = JSON.parse(content) as {active?: unknown; models?: unknown};
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			return null;
		}

		const models = Array.isArray(data.models)
			? data.models
					.map(normalizeItem)
					.filter((item): item is DecisionModelItem => item !== null)
			: [];
		const active = typeof data.active === 'string' ? data.active : '';

		return {
			// active 必须指向存在的条目，否则视为未激活，避免出现悬空引用
			active: models.some(model => model.id === active) ? active : '',
			models,
		};
	} catch {
		return null;
	}
}

export function saveDecisionModelsConfig(config: DecisionModelsConfig): void {
	ensureConfigDirectory();

	try {
		const content = JSON.stringify(config, null, 2);
		writeFileSync(DECISION_MODELS_FILE, content, 'utf8');
	} catch (error) {
		throw new Error(`Failed to save decision models config: ${error}`);
	}
}

/** 当前激活的决策模型条目；未配置或未激活时返回 undefined。 */
export function getActiveDecisionModel(): DecisionModelItem | undefined {
	const config = getDecisionModelsConfig();
	if (!config || !config.active) {
		return undefined;
	}

	return config.models.find(model => model.id === config.active);
}
