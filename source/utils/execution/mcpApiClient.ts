/**
 * 自定义 API 类型 MCP 客户端。
 *
 * 与 Snow APP 的 API 传输保持一致：`url` 为 Base URL，`headers` 为公共请求头，
 * `endpoints`（或 `args` 中的 `{cookies, endpoints}` 规格）为接口定义，
 * 每个接口暴露为一个 MCP 工具，调用时按定义拼接并发送 HTTP 请求。
 *
 * 支持两种配置形态：
 * 1. `{type: "api", url, headers, cookies, endpoints: [...]}`（Snow APP 编辑器输出）
 * 2. `{type: "api", url, headers, args: {cookies, endpoints}}`（Snow APP 数据库格式，
 *    args 也可能是该规格的 JSON 字符串）
 */
import {addProxyToFetchOptions} from '../core/proxyUtils.js';
import type {MCPServer} from '../config/apiConfig.js';

export interface MCPApiParam {
	name: string;
	type: string;
	required: boolean;
	description: string;
	location: string;
	defaultValue: string;
}

export interface MCPApiEndpoint {
	name: string;
	description: string;
	method: string;
	path: string;
	headers: Record<string, unknown>;
	params: MCPApiParam[];
	bodyType: string;
	bodyTemplate: string;
	rawContentType: string;
}

export interface MCPApiSpec {
	cookies: Record<string, unknown>;
	endpoints: MCPApiEndpoint[];
}

export interface MCPApiTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface MCPApiToolContent {
	type: 'text';
	text: string;
}

/** 缺失参数占位标记：渲染后从 JSON 结构中剔除对应字段。 */
const MISSING_MARKER = '\u0000snow-api-missing\u0000';
const DEFAULT_TIMEOUT_MS = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const toText = (value: unknown): string =>
	typeof value === 'string'
		? value
		: typeof value === 'number' || typeof value === 'boolean'
			? String(value)
			: '';

/** 把任意 JSON 值转为模板渲染文本（null 视为空串）。 */
const valueToText = (value: unknown): string => {
	if (value === null || value === undefined) {
		return '';
	}

	return typeof value === 'string' ? value : JSON.stringify(value);
};

const parseSpecValue = (value: unknown): Record<string, unknown> | null => {
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value);
			return isRecord(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	return isRecord(value) ? value : null;
};

const normalizeParams = (value: unknown): MCPApiParam[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter(isRecord).map(item => ({
		name: toText(item['name']).trim(),
		type: (toText(item['type']).trim() || 'string').toLowerCase(),
		required: item['required'] === true,
		description: toText(item['description']),
		location: (toText(item['location']).trim() || 'query').toLowerCase(),
		defaultValue: toText(item['defaultValue']),
	}));
};

const normalizeHeaderValues = (value: unknown): Record<string, unknown> => {
	if (!isRecord(value)) {
		return {};
	}

	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		const name = key.trim();
		if (name) {
			result[name] = item;
		}
	}

	return result;
};

const normalizeEndpoint = (value: unknown): MCPApiEndpoint => {
	const item = isRecord(value) ? value : {};
	return {
		name: toText(item['name']).trim(),
		description: toText(item['description']),
		method: toText(item['method']),
		path: toText(item['path']),
		headers: normalizeHeaderValues(item['headers']),
		params: normalizeParams(item['params']),
		bodyType: toText(item['bodyType']).trim().toLowerCase(),
		bodyTemplate: toText(item['bodyTemplate']),
		rawContentType: toText(item['rawContentType']).trim(),
	};
};

/** 解析服务的 API 规格（顶层 endpoints 优先，其次兼容 args 中的规格）。 */
export function getMCPApiSpec(server: MCPServer): MCPApiSpec {
	const specFromArgs = parseSpecValue(server.args);
	const rawEndpoints =
		Array.isArray(server.endpoints) && server.endpoints.length > 0
			? server.endpoints
			: specFromArgs?.['endpoints'];

	return {
		cookies: {
			...normalizeHeaderValues(specFromArgs?.['cookies']),
			...normalizeHeaderValues(server.cookies),
		},
		endpoints: Array.isArray(rawEndpoints)
			? rawEndpoints.map(endpoint => normalizeEndpoint(endpoint))
			: [],
	};
}

/** 判断服务是否应走自定义 API 传输。 */
export function isMCPApiServer(server: MCPServer): boolean {
	if (server.type === 'api') {
		return true;
	}

	if (Array.isArray(server.endpoints) && server.endpoints.length > 0) {
		return true;
	}

	const spec = parseSpecValue(server.args);
	return !!spec && Array.isArray(spec['endpoints']);
}

const normalizedMethodName = (method: string): string => {
	const upper = method.trim().toUpperCase();
	return upper || 'GET';
};

const jsonSchemaType = (paramType: string): string => {
	switch (paramType.trim().toLowerCase()) {
		case 'number': {
			return 'number';
		}

		case 'integer': {
			return 'integer';
		}

		case 'boolean': {
			return 'boolean';
		}

		case 'object': {
			return 'object';
		}

		case 'array': {
			return 'array';
		}

		default: {
			return 'string';
		}
	}
};

const endpointToolName = (index: number, endpoint: MCPApiEndpoint): string =>
	endpoint.name.trim() || `endpoint_${index + 1}`;

const endpointSignature = (endpoint: MCPApiEndpoint): string =>
	`${normalizedMethodName(endpoint.method)} ${endpoint.path.trim()}`;

const buildInputSchema = (params: MCPApiParam[]): Record<string, unknown> => {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const param of params) {
		const name = param.name.trim();
		if (!name) {
			continue;
		}

		const schemaType = jsonSchemaType(param.type);
		const property: Record<string, unknown> = {type: schemaType};
		if (schemaType === 'array') {
			property['items'] = {};
		}

		const defaultValue = param.defaultValue.trim();
		let description = param.description.trim();
		if (defaultValue) {
			const note = `Default: ${defaultValue}`;
			description = description ? `${description} (${note})` : note;
		}

		if (description) {
			property['description'] = description;
		}

		properties[name] = property;
		// 有默认值的参数模型可省略
		if (param.required && !defaultValue) {
			required.push(name);
		}
	}

	const schema: Record<string, unknown> = {
		type: 'object',
		properties,
	};
	if (required.length > 0) {
		schema['required'] = required;
	}

	return schema;
};

/** 把接口定义转换为 MCP 工具列表。 */
export function buildMCPApiTools(server: MCPServer): MCPApiTool[] {
	return getMCPApiSpec(server).endpoints.map((endpoint, index) => {
		const description = endpoint.description.trim();
		const signature = endpointSignature(endpoint);
		return {
			name: endpointToolName(index, endpoint),
			description: description ? `${description}\n(${signature})` : signature,
			inputSchema: buildInputSchema(endpoint.params),
		};
	});
}

const coerceText = (raw: string, paramType: string): unknown => {
	if (jsonSchemaType(paramType) === 'string') {
		return raw;
	}

	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return raw;
	}
};

/** 合并调用参数与默认值，缺少必填参数时报错。 */
const resolveValues = (
	params: MCPApiParam[],
	args: Record<string, unknown>,
): Map<string, unknown> => {
	const values = new Map<string, unknown>();
	for (const [key, value] of Object.entries(args)) {
		if (value !== null && value !== undefined) {
			values.set(key, value);
		}
	}

	for (const param of params) {
		const name = param.name.trim();
		if (!name || values.has(name)) {
			continue;
		}

		const defaultValue = param.defaultValue.trim();
		if (defaultValue) {
			values.set(name, coerceText(defaultValue, param.type));
		} else if (param.required) {
			throw new Error(`Missing required parameter: ${name}`);
		}
	}

	return values;
};

const isPlaceholderKey = (key: string): boolean =>
	key.length > 0 && /^[\w.$-]+$/.test(key);

const identityEncode = (text: string): string => text;

/** RFC 3986 组件编码（与 Snow APP 保持一致）。 */
const componentEncode = (text: string): string =>
	encodeURIComponent(text).replace(
		/[!'()*]/g,
		char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);

/** 替换文本中的 `{{name}}`，缺失参数替换为空串。 */
const renderText = (
	template: string,
	values: Map<string, unknown>,
	encode: (text: string) => string,
): string => {
	let output = '';
	let rest = template;

	for (;;) {
		const start = rest.indexOf('{{');
		if (start === -1) {
			break;
		}

		const close = rest.indexOf('}}', start + 2);
		if (close === -1) {
			break;
		}

		const key = rest.slice(start + 2, close).trim();
		output += rest.slice(0, start);
		if (isPlaceholderKey(key)) {
			output += encode(
				values.has(key) ? valueToText(values.get(key)) : '',
			);
		} else {
			output += rest.slice(start, close + 2);
		}

		rest = rest.slice(close + 2);
	}

	return output + rest;
};

const findPlaceholderEnd = (chars: string[], from: number): number | null => {
	for (let index = from; index + 1 < chars.length; index++) {
		if (chars[index] === '}' && chars[index + 1] === '}') {
			return index;
		}

		if (chars[index] === '\n' || chars[index] === '"') {
			return null;
		}
	}

	return null;
};

const isMissingMarker = (value: unknown): boolean =>
	typeof value === 'string' && value === MISSING_MARKER;

const standaloneJson = (found: unknown): string =>
	JSON.stringify(found === undefined ? MISSING_MARKER : found) ?? 'null';

/** 递归删除值为缺失标记的对象成员与数组元素。 */
const pruneMissing = (value: unknown): void => {
	if (Array.isArray(value)) {
		for (let index = value.length - 1; index >= 0; index--) {
			if (isMissingMarker(value[index])) {
				value.splice(index, 1);
			} else {
				pruneMissing(value[index]);
			}
		}

		return;
	}

	if (isRecord(value)) {
		for (const [key, item] of Object.entries(value)) {
			if (key === MISSING_MARKER || isMissingMarker(item)) {
				delete value[key];
			} else {
				pruneMissing(item);
			}
		}
	}
};

/**
 * JSON 模板渲染：`"{{x}}"` 整串或裸 `{{x}}` 按 JSON 值替换（保留类型，
 * 缺失时写入缺失标记），字符串内部的占位符按转义后的文本替换。
 */
const renderJson = (
	template: string,
	values: Map<string, unknown>,
): string => {
	const chars = [...template];
	const output: string[] = [];
	let inString = false;
	let escaped = false;
	let stringStartLength = 0;
	let index = 0;

	while (index < chars.length) {
		const char = chars[index]!;
		if (char === '{' && chars[index + 1] === '{' && !escaped) {
			const close = findPlaceholderEnd(chars, index + 2);
			if (close !== null) {
				const key = chars.slice(index + 2, close).join('').trim();
				if (isPlaceholderKey(key)) {
					const found = values.get(key);
					const after = close + 2;
					if (
						inString &&
						output.length === stringStartLength &&
						chars[after] === '"'
					) {
						output.pop();
						output.push(standaloneJson(found));
						inString = false;
						index = after + 1;
					} else if (inString) {
						const text =
							found === undefined ? '' : valueToText(found);
						const quoted = JSON.stringify(text);
						output.push(quoted.slice(1, -1));
						index = after;
					} else {
						output.push(standaloneJson(found));
						index = after;
					}

					continue;
				}
			}
		}

		output.push(char);
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
		} else if (char === '"') {
			inString = true;
			stringStartLength = output.length;
		}

		index++;
	}

	return output.join('');
};

/** 渲染 JSON 请求体并校验；独立占位符对应参数缺失时省略该字段。 */
const renderJsonBody = (
	template: string,
	values: Map<string, unknown>,
): string => {
	const rendered = renderJson(template, values);
	let parsed: unknown;
	try {
		parsed = JSON.parse(rendered);
	} catch (error) {
		throw new Error(
			`Rendered JSON body is invalid: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (!rendered.includes('snow-api-missing')) {
		return rendered;
	}

	pruneMissing(parsed);
	return JSON.stringify(isMissingMarker(parsed) ? null : parsed) ?? 'null';
};

const isMissingFormSegment = (
	segment: string,
	values: Map<string, unknown>,
): boolean => {
	const separator = segment.indexOf('=');
	if (separator === -1) {
		return false;
	}

	const raw = segment.slice(separator + 1).trim();
	if (!raw.startsWith('{{') || !raw.endsWith('}}')) {
		return false;
	}

	const key = raw.slice(2, -2).trim();
	return isPlaceholderKey(key) && !values.has(key);
};

/** 表单模板：`key={{x}}` 段在参数缺失时整段省略。 */
const renderForm = (template: string, values: Map<string, unknown>): string =>
	template
		.split('&')
		.filter(segment => !isMissingFormSegment(segment, values))
		.map(segment => renderText(segment, values, componentEncode))
		.join('&');

const joinUrl = (baseUrl: string, path: string): string => {
	const trimmedPath = path.trim();
	if (trimmedPath.startsWith('http://') || trimmedPath.startsWith('https://')) {
		return trimmedPath;
	}

	const base = baseUrl.trim().replace(/\/+$/, '');
	if (!trimmedPath) {
		return base;
	}

	if (trimmedPath.startsWith('?')) {
		return `${base}${trimmedPath}`;
	}

	return `${base}/${trimmedPath.replace(/^\/+/, '')}`;
};

type HeaderPair = [string, string];

const setHeader = (
	headers: HeaderPair[],
	name: string,
	value: string,
): void => {
	const existing = headers.find(
		([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
	);
	if (existing) {
		existing[1] = value;
	} else {
		headers.push([name, value]);
	}
};

const hasHeader = (headers: HeaderPair[], name: string): boolean =>
	headers.some(
		([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
	);

const locatedValues = (
	endpoint: MCPApiEndpoint,
	values: Map<string, unknown>,
	location: string,
): Array<[string, unknown]> => {
	const result: Array<[string, unknown]> = [];
	for (const param of endpoint.params) {
		if (param.location.trim().toLowerCase() !== location) {
			continue;
		}

		const name = param.name.trim();
		if (values.has(name)) {
			result.push([name, values.get(name)]);
		}
	}

	return result;
};

interface PreparedApiRequest {
	method: string;
	url: URL;
	headers: HeaderPair[];
	body: string | FormData | undefined;
}

const prepareBody = (
	endpoint: MCPApiEndpoint,
	values: Map<string, unknown>,
	headers: HeaderPair[],
): string | FormData | undefined => {
	const bodyValues = locatedValues(endpoint, values, 'body');
	const template = endpoint.bodyTemplate.trim();

	switch (endpoint.bodyType.trim().toLowerCase()) {
		case 'json': {
			let text: string;
			if (!template) {
				const object: Record<string, unknown> = {};
				for (const [name, value] of bodyValues) {
					object[name] = value;
				}

				text = JSON.stringify(object);
			} else {
				text = renderJsonBody(template, values);
			}

			if (!hasHeader(headers, 'content-type')) {
				headers.push(['Content-Type', 'application/json']);
			}

			return text;
		}

		case 'form': {
			let text: string;
			if (!template) {
				const search = new URLSearchParams();
				for (const [name, value] of bodyValues) {
					search.append(name, valueToText(value));
				}

				text = search.toString();
			} else {
				text = renderForm(template, values);
			}

			if (!hasHeader(headers, 'content-type')) {
				headers.push([
					'Content-Type',
					'application/x-www-form-urlencoded',
				]);
			}

			return text;
		}

		case 'multipart': {
			const form = new FormData();
			for (const [name, value] of bodyValues) {
				form.append(name, valueToText(value));
			}

			return form;
		}

		case 'raw': {
			if (!hasHeader(headers, 'content-type')) {
				headers.push([
					'Content-Type',
					endpoint.rawContentType || 'text/plain',
				]);
			}

			return renderText(endpoint.bodyTemplate, values, identityEncode);
		}

		default: {
			return undefined;
		}
	}
};

const prepareRequest = (
	server: MCPServer,
	spec: MCPApiSpec,
	endpoint: MCPApiEndpoint,
	args: Record<string, unknown>,
): PreparedApiRequest => {
	const values = resolveValues(endpoint.params, args);
	const method = normalizedMethodName(endpoint.method);
	const rawUrl = joinUrl(
		server.url ?? '',
		renderText(endpoint.path, values, componentEncode),
	);

	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid request URL: ${rawUrl}`);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Unsupported URL scheme: ${url.protocol.replace(':', '')}`);
	}

	for (const [name, value] of locatedValues(endpoint, values, 'query')) {
		if (Array.isArray(value)) {
			for (const item of value) {
				url.searchParams.append(name, valueToText(item));
			}
		} else {
			url.searchParams.append(name, valueToText(value));
		}
	}

	const headers: HeaderPair[] = [];
	for (const [name, value] of Object.entries(server.headers ?? {})) {
		setHeader(
			headers,
			name.trim(),
			renderText(valueToText(value), values, identityEncode),
		);
	}

	for (const [name, value] of Object.entries(endpoint.headers)) {
		setHeader(headers, name, renderText(valueToText(value), values, identityEncode));
	}

	for (const [name, value] of locatedValues(endpoint, values, 'header')) {
		setHeader(headers, name, valueToText(value));
	}

	const cookieText = Object.entries(spec.cookies)
		.filter(([name]) => name.trim())
		.map(
			([name, value]) =>
				`${name.trim()}=${renderText(valueToText(value), values, identityEncode)}`,
		)
		.join('; ');
	if (cookieText) {
		const existing = headers
			.find(([name]) => name.toLowerCase() === 'cookie')
			?.[1].trim()
			.replace(/;$/, '');
		setHeader(headers, 'Cookie', existing ? `${existing}; ${cookieText}` : cookieText);
	}

	const body = prepareBody(endpoint, values, headers);

	return {method, url, headers, body};
};

interface ApiHttpResponse {
	status: number;
	statusText: string;
	contentType: string;
	body: string;
}

const formatApiResponse = (response: ApiHttpResponse): string => {
	let text = `HTTP ${response.status} ${response.statusText}`.trimEnd();
	if (response.contentType) {
		text += `\nContent-Type: ${response.contentType}`;
	}

	return `${text}\n\n${response.body}`;
};

const describeFetchError = (error: unknown): string => {
	if (error instanceof Error) {
		const cause = (error as {cause?: unknown}).cause;
		if (cause instanceof Error && cause.message !== error.message) {
			return `${error.message}: ${cause.message}`;
		}

		return error.message;
	}

	return String(error);
};

const sendRequest = async (
	prepared: PreparedApiRequest,
	timeoutMs: number,
	abortSignal?: AbortSignal,
): Promise<ApiHttpResponse> => {
	const controller = new AbortController();
	let abortedBySignal = false;
	const handleAbort = () => {
		abortedBySignal = true;
		controller.abort();
	};

	if (abortSignal) {
		if (abortSignal.aborted) {
			handleAbort();
		} else {
			abortSignal.addEventListener('abort', handleAbort, {once: true});
		}
	}

	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const headers: Record<string, string> = {};
		for (const [name, value] of prepared.headers) {
			headers[name] = value;
		}

		const init: RequestInit = {
			method: prepared.method,
			headers,
			signal: controller.signal,
		};

		// fetch 不允许 GET/HEAD 携带请求体（reqwest 允许），此处静默忽略以保证兼容
		if (
			prepared.body !== undefined &&
			prepared.method !== 'GET' &&
			prepared.method !== 'HEAD'
		) {
			init.body = prepared.body as BodyInit;
		}

		const url = prepared.url.toString();
		const response = await fetch(
			url,
			addProxyToFetchOptions(url, init),
		);
		const body = await response.text();

		return {
			status: response.status,
			statusText: response.statusText,
			contentType: response.headers.get('content-type') ?? '',
			body,
		};
	} catch (error) {
		if (abortedBySignal) {
			throw new Error('Request aborted by user');
		}

		if (controller.signal.aborted) {
			throw new Error(`Request timed out after ${timeoutMs}ms`);
		}

		throw new Error(`Request failed: ${describeFetchError(error)}`);
	} finally {
		clearTimeout(timer);
		abortSignal?.removeEventListener('abort', handleAbort);
	}
};

/**
 * 执行自定义 API 类型的 MCP 工具。
 * 参数/网络错误以文本结果返回，便于模型据此修正调用。
 */
export async function executeMCPApiTool(
	server: MCPServer,
	toolName: string,
	args: unknown,
	abortSignal?: AbortSignal,
): Promise<MCPApiToolContent[]> {
	try {
		const spec = getMCPApiSpec(server);
		const endpointIndex = spec.endpoints.findIndex(
			(endpoint, index) => endpointToolName(index, endpoint) === toolName,
		);
		if (endpointIndex === -1) {
			throw new Error(`Custom API endpoint "${toolName}" not found`);
		}

		const endpoint = spec.endpoints[endpointIndex]!;
		const prepared = prepareRequest(
			server,
			spec,
			endpoint,
			isRecord(args) ? args : {},
		);
		const response = await sendRequest(
			prepared,
			server.timeout ?? DEFAULT_TIMEOUT_MS,
			abortSignal,
		);
		return [{type: 'text', text: formatApiResponse(response)}];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return [{type: 'text', text: `[Snow API MCP] ${message}`}];
	}
}
