/**
 * 飞书开放平台 OpenAPI 封装。
 *
 * 只覆盖 /connect 需要的能力：租户令牌、发送文本消息、下载消息资源。
 */

export const DEFAULT_FEISHU_DOMAIN = 'https://open.feishu.cn';
export const FEISHU_TEXT_LIMIT = 3000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function normalizeFeishuDomain(value: string): string {
	const raw = String(value ?? '').trim();
	if (!raw) {
		return DEFAULT_FEISHU_DOMAIN;
	}
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
	return withScheme.replace(/\/+$/, '');
}

export function splitFeishuText(
	input: string,
	limit = FEISHU_TEXT_LIMIT,
): string[] {
	const text = String(input ?? '');
	if (text.length <= limit) {
		return [text];
	}
	const chunks: string[] = [];
	let rest = text;
	while (rest.length > limit) {
		let cut = rest.lastIndexOf('\n', limit);
		if (cut < Math.floor(limit / 2)) {
			cut = limit;
		}
		chunks.push(rest.slice(0, cut));
		rest = rest.slice(cut).replace(/^\n+/, '');
	}
	if (rest) {
		chunks.push(rest);
	}
	return chunks.length > 0 ? chunks : [''];
}

export type FeishuApi = ReturnType<typeof createFeishuApi>;

export function createFeishuApi(domainValue: string) {
	const domain = normalizeFeishuDomain(domainValue);
	let token = '';
	let tokenExpiresAt = 0;

	const requestJson = async <T = any>(
		path: string,
		options: {
			method?: string;
			body?: unknown;
			bearer?: string;
			query?: Record<string, string>;
			timeoutMs?: number;
		} = {},
	): Promise<T> => {
		const {
			method = 'GET',
			body,
			bearer,
			query,
			timeoutMs = 30000,
		} = options;
		const search = query ? `?${new URLSearchParams(query).toString()}` : '';
		const response = await fetch(`${domain}${path}${search}`, {
			method,
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				...(bearer ? {Authorization: `Bearer ${bearer}`} : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const parsed = (await response.json().catch(() => null)) as any;
		if (!parsed) {
			throw new Error(`飞书接口返回异常（HTTP ${response.status}）`);
		}
		if (parsed.code !== undefined && parsed.code !== 0) {
			throw new Error(
				`飞书接口失败（code=${parsed.code}）：${parsed.msg ?? '未知错误'}`,
			);
		}
		return parsed as T;
	};

	const tenantAccessToken = async (
		appId: string,
		appSecret: string,
		force = false,
	): Promise<string> => {
		const now = Date.now();
		if (!force && token && now < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
			return token;
		}
		const response = await requestJson<{
			tenant_access_token?: string;
			expire?: number;
		}>('/open-apis/auth/v3/tenant_access_token/internal', {
			method: 'POST',
			body: {app_id: appId, app_secret: appSecret},
			timeoutMs: 20000,
		});
		const next = String(response.tenant_access_token ?? '');
		if (!next) {
			throw new Error('飞书租户令牌获取失败：响应中没有 tenant_access_token');
		}
		token = next;
		tokenExpiresAt = now + Math.max(60, Number(response.expire ?? 7200)) * 1000;
		return token;
	};

	const sendText = async (
		appId: string,
		appSecret: string,
		chatId: string,
		text: string,
	): Promise<void> => {
		const accessToken = await tenantAccessToken(appId, appSecret);
		const chunks = splitFeishuText(text);
		for (const chunk of chunks) {
			await requestJson('/open-apis/im/v1/messages', {
				method: 'POST',
				bearer: accessToken,
				query: {receive_id_type: 'chat_id'},
				body: {
					receive_id: chatId,
					msg_type: 'text',
					content: JSON.stringify({text: chunk}),
				},
				timeoutMs: 30000,
			});
		}
	};

	const downloadResource = async (
		appId: string,
		appSecret: string,
		messageId: string,
		fileKey: string,
		type: 'image' | 'file',
		maxBytes = 20 * 1024 * 1024,
	): Promise<{buffer: Buffer; contentType: string}> => {
		const accessToken = await tenantAccessToken(appId, appSecret);
		const url = `${domain}/open-apis/im/v1/messages/${encodeURIComponent(
			messageId,
		)}/resources/${encodeURIComponent(fileKey)}?type=${type}`;
		const response = await fetch(url, {
			headers: {Authorization: `Bearer ${accessToken}`},
			signal: AbortSignal.timeout(60000),
		});
		if (!response.ok) {
			const detail = (await response.text().catch(() => '')).slice(0, 300);
			throw new Error(
				`飞书资源下载失败（HTTP ${response.status}${
					detail ? `：${detail}` : ''
				}）`,
			);
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.length > maxBytes) {
			throw new Error('飞书资源超过大小上限');
		}
		return {
			buffer,
			contentType: String(response.headers.get('content-type') ?? ''),
		};
	};

	const resetToken = (): void => {
		token = '';
		tokenExpiresAt = 0;
	};

	return {
		domain,
		tenantAccessToken,
		sendText,
		downloadResource,
		resetToken,
		describe,
	};
}
