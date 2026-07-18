/**
 * Minimal AGENTS.md-first context inject (Codex/Claude-style).
 * ROLE.md is intentionally NOT handled here — see promptHelpers.getSystemPromptWithRole.
 */

export type ContextInjectProfile = 'full' | 'compact' | 'off';

export interface ContextInjectSettings {
	/** Master switch. Default true. */
	enabled?: boolean;
	/** Total injected body budget (chars). Default 32000 (~Codex 32KiB). */
	budgetChars?: number;
	profile?: ContextInjectProfile;
	/** Extra project filenames after AGENTS.md (e.g. CLAUDE.md). */
	fallbackFilenames?: string[];
	/** Write .snow/log/injected-rules.txt. Default false (simpler). */
	writeBreadcrumb?: boolean;
}

export type SourceKind = 'global-agents' | 'project-agents';

export interface DiscoveredSource {
	kind: SourceKind;
	absPath: string;
	relLabel: string;
	/** Lower = earlier in prompt (global first, then root→cwd). */
	priority: number;
}

export interface LoadedSource extends DiscoveredSource {
	content: string;
	chars: number;
	truncated: boolean;
	mtimeMs: number;
}

export interface InjectSourceReport {
	kind: SourceKind;
	relLabel: string;
	chars: number;
	truncated: boolean;
	included: boolean;
}

export interface InjectRenderResult {
	section: string;
	totalChars: number;
	truncated: boolean;
	sources: InjectSourceReport[];
	breadcrumbPath?: string;
}

export interface ResolvedContextInjectConfig {
	enabled: boolean;
	budgetChars: number;
	profile: ContextInjectProfile;
	fallbackFilenames: string[];
	writeBreadcrumb: boolean;
	/** Primary filename per directory. */
	primaryFilename: string;
	compactBudgetChars: number;
	perFileMax: number;
}
