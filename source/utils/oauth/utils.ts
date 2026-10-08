/**
 * OAuth 基础工具：PKCE / state 生成、JWT 解析、时间戳等。
 */

import {createHash, randomBytes, randomUUID} from 'crypto';
import type {OAuthPkceCodes} from './types.js';

/** 生成 URL 安全的随机串（base64url，无填充） */
export function randomBase64Url(bytesLength: number): string {
	return randomBytes(bytesLength).toString('base64url');
}

export function generatePkce(): OAuthPkceCodes {
	const verifier = randomBase64Url(64);
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return {verifier, challenge};
}

export function generateState(): string {
	return randomBase64Url(32);
}

export function generateSessionId(): string {
	return randomUUID();
}

/** 当前时间（epoch 秒） */
export function nowEpochSecs(): number {
	return Math.floor(Date.now() / 1000);
}

/** 解析 JWT 的 payload 段；失败返回 null */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
	const trimmed = jwt.trim();
	if (!trimmed) {
		return null;
	}
	const parts = trimmed.split('.');
	if (parts.length < 2 || !parts[1]) {
		return null;
	}
	try {
		const decoded = Buffer.from(parts[1], 'base64url').toString('utf8');
		const parsed = JSON.parse(decoded);
		return parsed && typeof parsed === 'object'
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** 取 JWT 的 exp 字段（epoch 秒） */
export function jwtExpiry(jwt: string): number | null {
	const payload = decodeJwtPayload(jwt);
	const exp = payload?.['exp'];
	return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

export function readString(
	source: Record<string, unknown> | null | undefined,
	key: string,
): string {
	const value = source?.[key];
	return typeof value === 'string' ? value.trim() : '';
}

/** 数值字段读取（token 响应里的 expires_in 等） */
export function readNumber(
	source: Record<string, unknown> | null | undefined,
	key: string,
): number | undefined {
	const value = source?.[key];
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/** 对 fetch 加超时（Node 22 全局 fetch） */
export async function fetchWithTimeout(
	url: string,
	options: RequestInit,
	timeoutSecs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutSecs * 1000);
	try {
		return await fetch(url, {...options, signal: controller.signal});
	} finally {
		clearTimeout(timer);
	}
}
