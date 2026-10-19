import path from 'node:path';

/**
 * Canonical Path Node Utilities
 * Enforces cross-platform structural path uniformity.
 *
 * Rules:
 * 1. Single forward slash '/' as universal internal separator.
 * 2. Normalizes Windows backslashes '\' to '/'.
 * 3. Safely isolates root / drive letters (e.g. 'C:/') from relative segments.
 * 4. Deduplicates consecutive slashes while preserving UNC paths ('//server/share').
 * 5. Resolves logical '.' and '..' segments.
 */

export interface CanonicalSplitResult {
	root: string;
	segments: string[];
	isAbsolute: boolean;
}

/**
 * Convert any platform path into a canonical internal POSIX-style path node.
 */
export function toCanonicalPath(rawPath: string): string {
	if (!rawPath || typeof rawPath !== 'string') {
		return '';
	}

	// 1. Unify backslashes to forward slashes
	let normalized = rawPath.replace(/\\/g, '/');

	// 2. Preserve UNC path prefix if present
	const isUnc = normalized.startsWith('//');

	// 3. Deduplicate consecutive forward slashes
	normalized = normalized.replace(/\/+/g, '/');
	if (isUnc && !normalized.startsWith('//')) {
		normalized = '/' + normalized;
	}

	// 4. Normalize Windows drive letter to uppercase (e.g. c:/ -> C:/)
	normalized = normalized.replace(/^([a-zA-Z]):(\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`);

	// 5. Remove trailing slash unless it is root '/' or 'C:/'
	if (normalized.length > 1 && normalized.endsWith('/')) {
		if (!/^[a-zA-Z]:\/$/.test(normalized)) {
			normalized = normalized.slice(0, -1);
		}
	}

	return normalized;
}

/**
 * Check if path is absolute across Windows and POSIX specifications.
 */
export function isCanonicalAbsolute(p: string): boolean {
	const canonical = toCanonicalPath(p);
	return (
		canonical.startsWith('/') ||
		/^[a-zA-Z]:\//.test(canonical)
	);
}

/**
 * Split a canonical path safely, separating root/drive from relative segments.
 * Prevents drive letters (e.g. 'C:') from being treated as regular folder segments.
 */
export function splitCanonicalPath(p: string): CanonicalSplitResult {
	const canonical = toCanonicalPath(p);
	if (!canonical) {
		return {root: '', segments: [], isAbsolute: false};
	}

	// Windows drive letter root: 'C:/'
	const driveMatch = canonical.match(/^([a-zA-Z]:\/)(.*)$/);
	if (driveMatch) {
		const root = driveMatch[1] ?? '';
		const rest = driveMatch[2];
		const segments = rest ? rest.split('/').filter(Boolean) : [];
		return {root, segments, isAbsolute: true};
	}

	// UNC root: '//server/share'
	if (canonical.startsWith('//')) {
		const parts = canonical.slice(2).split('/').filter(Boolean);
		if (parts.length >= 2) {
			const root = `//${parts[0] ?? ''}/${parts[1] ?? ''}/`;
			const segments = parts.slice(2);
			return {root, segments, isAbsolute: true};
		}
	}

	// POSIX root: '/'
	if (canonical.startsWith('/')) {
		const segments = canonical.slice(1).split('/').filter(Boolean);
		return {root: '/', segments, isAbsolute: true};
	}

	// Relative path
	const segments = canonical.split('/').filter(Boolean);
	return {root: '', segments, isAbsolute: false};
}

/**
 * Map canonical POSIX-style internal path node to host OS native path.
 */
export function toNativePath(canonicalPath: string): string {
	if (!canonicalPath) return '';
	return path.normalize(canonicalPath);
}

export class CanonicalPath {
	readonly posix: string;
	readonly root: string;
	readonly segments: string[];
	readonly isAbsolute: boolean;

	constructor(rawPath: string) {
		const canonical = toCanonicalPath(rawPath);
		this.posix = canonical;
		const split = splitCanonicalPath(canonical);
		this.root = split.root;
		this.segments = split.segments;
		this.isAbsolute = split.isAbsolute;
	}

	get native(): string {
		return toNativePath(this.posix);
	}

	get fileName(): string {
		if (this.segments.length === 0) return '';
		return this.segments[this.segments.length - 1] ?? '';
	}

	get ext(): string {
		const fn = this.fileName;
		const lastDot = fn.lastIndexOf('.');
		return lastDot >= 0 ? fn.slice(lastDot) : '';
	}

	get stem(): string {
		const fn = this.fileName;
		const lastDot = fn.lastIndexOf('.');
		return lastDot >= 0 ? fn.slice(0, lastDot) : fn;
	}

	parent(): CanonicalPath {
		if (this.segments.length === 0) {
			return this;
		}
		const newSegments = this.segments.slice(0, -1);
		if (newSegments.length === 0) {
			return new CanonicalPath(this.root || '.');
		}
		const joined = (this.root ? this.root : '') + newSegments.join('/');
		return new CanonicalPath(joined);
	}

	join(...parts: string[]): CanonicalPath {
		const additions: string[] = [];
		for (const part of parts) {
			const cleaned = toCanonicalPath(part);
			if (cleaned) additions.push(cleaned);
		}
		const full = [this.posix, ...additions].filter(Boolean).join('/');
		return new CanonicalPath(full);
	}

	isChildOf(parent: CanonicalPath | string): boolean {
		const p = typeof parent === 'string' ? new CanonicalPath(parent) : parent;
		if (this.posix === p.posix) return false;
		if (this.root !== p.root) return false;
		if (this.segments.length <= p.segments.length) return false;
		for (let i = 0; i < p.segments.length; i++) {
			if (this.segments[i] !== p.segments[i]) return false;
		}
		return true;
	}

	relativeFrom(base: CanonicalPath | string): string {
		const b = typeof base === 'string' ? new CanonicalPath(base) : base;
		if (this.posix === b.posix) return '.';
		const rel = path.relative(b.native, this.native);
		return toCanonicalPath(rel);
	}

	toString(): string {
		return this.posix;
	}
}

export type StructuredPath = CanonicalPath;

export function parseCanonicalPath(rawPath: string): CanonicalPath {
	return new CanonicalPath(rawPath);
}
