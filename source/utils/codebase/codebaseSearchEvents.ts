import {EventEmitter} from 'events';

export type CodebaseSearchEvent = {
	type: 'search-start' | 'search-retry' | 'search-complete';
	attempt: number;
	maxAttempts: number;
	currentTopN: number;
	message: string;
	query?: string;
	// Original results count (before AI review)
	originalResultsCount?: number;
	// AI suggested search query (single best suggestion)
	suggestion?: string;
};

class CodebaseSearchEventEmitter extends EventEmitter {
	emitSearchEvent(event: CodebaseSearchEvent) {
		this.emit('codebase-search', event);
	}

	onSearchEvent(callback: (event: CodebaseSearchEvent) => void) {
		this.on('codebase-search', callback);
	}

	removeSearchEventListener(callback: (event: CodebaseSearchEvent) => void) {
		this.off('codebase-search', callback);
	}
}

export const codebaseSearchEvents = new CodebaseSearchEventEmitter();
