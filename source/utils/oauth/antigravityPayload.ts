/**
 * Antigravity（Cloud Code Assist）请求适配：
 * 把标准 Gemini 请求体包装成 Code Assist 内部协议载荷，并解析内部端点。
 *
 * 从 Snow App 的 native/src/api/gemini/payload.rs 移植。
 */

import {randomUUID} from 'crypto';
import {cleanToolSchema} from './antigravitySchema.js';

/** 解析 Antigravity 流式端点：`{base}/v1internal:streamGenerateContent?alt=sse` */
export function resolveAntigravityEndpoint(baseUrl: string): string {
	const base = baseUrl.trim().replace(/\/+$/, '');
	return `${base}/v1internal:streamGenerateContent?alt=sse`;
}

/**
 * 包装为 Code Assist 载荷：
 * - 清理 functionDeclarations 参数 schema（Gemini 3 / Claude 兼容处理）
 * - Claude 模型注入 toolConfig(VALIDATED)；非 Claude 模型移除 maxOutputTokens
 * - 外层包裹 project / model / request / requestType / userAgent / requestId
 */
export function wrapAntigravityPayload(
	payload: Record<string, unknown>,
	model: string,
	projectId: string,
): Record<string, unknown> {
	const cleanModel = model.startsWith('models/')
		? model.slice('models/'.length)
		: model;
	const modelLower = cleanModel.toLowerCase();
	const isClaude = modelLower.includes('claude');
	const requirePlaceholder =
		isClaude ||
		modelLower.includes('gemini-3-pro') ||
		modelLower.includes('gemini-3.1-pro');

	const requestPayload: Record<string, unknown> = {...payload};

	if (Array.isArray(requestPayload['tools'])) {
		requestPayload['tools'] = sanitizeAntigravityTools(
			requestPayload['tools'] as unknown[],
			requirePlaceholder,
		);
	}

	if (isClaude) {
		requestPayload['toolConfig'] = {
			functionCallingConfig: {mode: 'VALIDATED'},
		};
	} else if (
		requestPayload['generationConfig'] &&
		typeof requestPayload['generationConfig'] === 'object'
	) {
		const generationConfig = {
			...(requestPayload['generationConfig'] as Record<string, unknown>),
		};
		delete generationConfig['maxOutputTokens'];
		requestPayload['generationConfig'] = generationConfig;
	}

	const envelope: Record<string, unknown> = {};
	const trimmedProject = projectId.trim();
	if (trimmedProject) {
		envelope['project'] = trimmedProject;
	}
	envelope['model'] = cleanModel;
	envelope['request'] = requestPayload;
	envelope['requestType'] = 'agent';
	envelope['userAgent'] = 'antigravity';
	envelope['requestId'] = `agent-${randomUUID()}`;
	return envelope;
}

function sanitizeAntigravityTools(
	tools: unknown[],
	requirePlaceholder: boolean,
): unknown[] {
	return tools.map(tool => {
		if (!tool || typeof tool !== 'object') {
			return tool;
		}
		const record = {...(tool as Record<string, unknown>)};
		for (const key of ['functionDeclarations', 'function_declarations']) {
			const declarations = record[key];
			if (!Array.isArray(declarations)) {
				continue;
			}
			record[key] = declarations.map(declaration => {
				if (!declaration || typeof declaration !== 'object') {
					return declaration;
				}
				const entry = {...(declaration as Record<string, unknown>)};
				if (entry['parameters'] !== undefined) {
					entry['parameters'] = cleanToolSchema(
						entry['parameters'],
						requirePlaceholder,
					);
				}
				return entry;
			});
		}
		return record;
	});
}
