import {EventEmitter} from 'events';
import type {HookType} from '../config/hooksConfig.js';

export type HookStatusPhase =
	| 'start'
	| 'action'
	| 'success'
	| 'failed'
	| 'idle';

export type HookStatusEvent = {
	executionId: string;
	phase: HookStatusPhase;
	hookType: HookType;
	/** Current action label (command / prompt snippet) */
	actionLabel?: string;
	/** command | prompt */
	actionType?: 'command' | 'prompt';
	/** 1-based index of the current action */
	actionIndex?: number;
	totalActions?: number;
	executedActions?: number;
	failedActions?: number;
	/**
	 * Soft outcomes (command exit 1): intentional replace/warn signals,
	 * not hard failures. UI should not show these as "failed".
	 */
	softActions?: number;
	message?: string;
};

type HookStatusListener = (event: HookStatusEvent | null) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const EVENT = 'hook-status';

export function emitHookStatus(event: HookStatusEvent | null): void {
	emitter.emit(EVENT, event);
}

export function onHookStatus(listener: HookStatusListener): () => void {
	emitter.on(EVENT, listener);
	return () => {
		emitter.off(EVENT, listener);
	};
}

/** Truncate long command/prompt for the status line. */
export function summarizeHookAction(
	text: string | undefined,
	maxLen = 48,
): string | undefined {
	if (!text) {
		return undefined;
	}
	const oneLine = text.replace(/\s+/g, ' ').trim();
	if (oneLine.length <= maxLen) {
		return oneLine;
	}
	return `${oneLine.slice(0, Math.max(1, maxLen - 1))}…`;
}
