/**
 * Path helpers for remote (ssh://...) workspaces.
 *
 * Why a dedicated module?
 * - Node's `path.resolve` / `path.relative` / `path.join` mangle `ssh://user@host:port/...`
 *   URLs (they treat the protocol as a path segment and collapse double slashes).
 * - The remote shell is always assumed to be POSIX, so all remote path math runs on '/'.
 * - The local CLI may run on Windows; we never want native path separators in remote URLs.
 */

import {parseSSHUrl} from '../../../utils/ssh/sshClient.js';

/**
 * Lightweight check used by the public API surface.
 */
export function isSSHPath(p: string | undefined | null): p is string {
	return typeof p === 'string' && p.startsWith('ssh://');
}

export interface SshUrlParts {
	/** `ssh://user@host:port` (no trailing slash, no path) */
	prefix: string;
	/** Absolute POSIX path on the remote, always starts with `/`, no trailing slash (except root) */
	root: string;
	username: string;
	host: string;
	port: number;
}

/**
 * Parse an `ssh://user@host:port/abs/path` URL into its pieces.
 * Returns null when the URL doesn't match the expected shape.
 */
export function splitSshUrl(url: string): SshUrlParts | null {
	const parsed = parseSSHUrl(url);
	if (!parsed) return null;
	const prefix = `ssh://${parsed.username}@${parsed.host}:${parsed.port}`;
	let root = parsed.path || '/';
	// Normalize backslashes (defensive — `parseSSHUrl` returns whatever the URL contained)
	root = root.replace(/\\/g, '/');
	// Collapse trailing slash for everything except '/'
	if (root.length > 1 && root.endsWith('/')) {
		root = root.replace(/\/+$/, '');
	}
	return {
		prefix,
		root,
		username: parsed.username,
		host: parsed.host,
		port: parsed.port,
	};
}

/**
 * Join POSIX path segments. Collapses multiple slashes and resolves trailing/leading slashes.
 * Does NOT resolve `..` — we don't need it here and it would mask programmer errors.
 */
export function posixJoin(...segments: string[]): string {
	const filtered = segments.filter(s => s && s.length > 0);
	if (filtered.length === 0) return '';
	const joined = filtered.join('/').replace(/\\/g, '/');
	// Collapse consecutive slashes but keep a leading one if the very first segment had it.
	const leading = filtered[0]!.startsWith('/') ? '/' : '';
	return leading + joined.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

/**
 * Convert a remote absolute path into an `ssh://` URL using the prefix from `baseUrl`.
 */
export function toSshUrl(baseUrl: string, absoluteRemotePath: string): string {
	const parts = splitSshUrl(baseUrl);
	if (!parts) {
		// Best effort: assume the caller knows what they're doing.
		return baseUrl + absoluteRemotePath;
	}
	// Make sure absoluteRemotePath starts with '/'
	const abs = absoluteRemotePath.startsWith('/')
		? absoluteRemotePath
		: '/' + absoluteRemotePath;
	return parts.prefix + abs;
}

/**
 * Convert a path that may be relative (to root) into a remote-absolute path.
 * - Absolute input (starts with '/'): returned as-is (after slash normalization).
 * - Relative input: joined under `root`.
 */
export function resolveRemotePath(root: string, p: string): string {
	const normalized = p.replace(/\\/g, '/');
	if (normalized.startsWith('/')) {
		return normalized;
	}
	return posixJoin(root, normalized);
}

/**
 * Compute a relative POSIX path from `root` to `target`.
 * Both paths are assumed absolute. Falls back to `target` when it isn't under `root`.
 */
export function relativeRemotePath(root: string, target: string): string {
	const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
	const t = target.replace(/\\/g, '/');
	if (r && t.startsWith(r + '/')) {
		return t.slice(r.length + 1);
	}
	if (t === r) return '';
	return t;
}
