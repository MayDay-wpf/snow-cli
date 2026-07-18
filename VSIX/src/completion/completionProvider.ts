import * as vscode from 'vscode';
import {CompletionConfig, isLanguageEnabled} from './completionConfig';
import {CompletionRequest, requestCompletion} from './completionClient';
import {log} from './logger';

interface CacheEntry {
	prefixKey: string;
	completion: string;
}

const MAX_CACHE_SIZE = 32;

export class SnowInlineCompletionProvider
	implements vscode.InlineCompletionItemProvider
{
	private readonly cache = new Map<string, CacheEntry>();
	private currentAbort: AbortController | undefined;
	private currentKey: string | undefined;

	constructor(
		private readonly getConfig: () => CompletionConfig,
		private readonly statusBar: {
			setLoading: (loading: boolean) => void;
			setMessage: (msg: string | undefined) => void;
		},
	) {}

	public dispose(): void {
		this.cache.clear();
		this.cancelCurrent();
	}

	public clearCache(): void {
		this.cache.clear();
	}

	private cancelCurrent(): void {
		if (this.currentAbort) {
			this.currentAbort.abort();
			this.currentAbort = undefined;
		}
		this.currentKey = undefined;

		this.statusBar.setLoading(false);
	}

	private extractContext(
		document: vscode.TextDocument,
		position: vscode.Position,
		config: CompletionConfig,
	): {prefix: string; suffix: string} {
		const startLine = Math.max(0, position.line - config.contextPrefixLines);
		const endLine = Math.min(
			document.lineCount - 1,
			position.line + config.contextSuffixLines,
		);
		const prefixRange = new vscode.Range(
			new vscode.Position(startLine, 0),
			position,
		);
		const suffixRange = new vscode.Range(
			position,
			document.lineAt(endLine).range.end,
		);
		return {
			prefix: document.getText(prefixRange),
			suffix: document.getText(suffixRange),
		};
	}

	public async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<
		vscode.InlineCompletionList | vscode.InlineCompletionItem[] | undefined
	> {
		const config = this.getConfig();
		log(
			`provideInlineCompletionItems called: lang=${document.languageId}, line=${
				position.line
			}, col=${position.character}, enabled=${config.enabled}, provider=${
				config.provider
			}, model=${config.model || '(empty)'}`,
		);
		if (!config.enabled) {
			log('skip: completion disabled');
			return undefined;
		}
		if (!isLanguageEnabled(config, document.languageId)) {
			log(
				`skip: language ${
					document.languageId
				} not in allowed list ${JSON.stringify(config.languages)}`,
			);
			return undefined;
		}
		if (!config.apiKey) {
			log('skip: apiKey is empty');
			this.statusBar.setMessage('Snow Completion: API Key not set');
			return undefined;
		}
		if (!config.model) {
			log('skip: model is empty');
			this.statusBar.setMessage('Snow Completion: Model not selected');
			return undefined;
		}

		const {prefix, suffix} = this.extractContext(document, position, config);
		if (!prefix.trim() && !suffix.trim()) {
			log('skip: empty prefix and suffix');
			return undefined;
		}

		// De-dup key uses document version + offset + last 100 chars of prefix.
		const offset = document.offsetAt(position);
		const tail = prefix.slice(-100);
		const cacheKey = `${document.uri.toString()}::${offset}::${tail}`;

		const cached = this.cache.get(cacheKey);
		if (cached && cached.completion) {
			return [
				new vscode.InlineCompletionItem(
					cached.completion,
					new vscode.Range(position, position),
				),
			];
		}

		// Cancel any earlier inflight that no longer matches this key.
		if (this.currentKey !== cacheKey) {
			this.cancelCurrent();
		}

		const abort = new AbortController();
		this.currentAbort = abort;
		this.currentKey = cacheKey;

		// Bridge VS Code cancellation to AbortController.
		const cancelSub = token.onCancellationRequested(() => abort.abort());

		const req: CompletionRequest = {
			prefix,
			suffix,
			languageId: document.languageId,
			fileName: document.fileName,
			signal: abort.signal,
		};

		// Debounce: wait before sending the request; if user keeps typing the
		// token gets cancelled by VS Code which aborts the request below.
		const debounceMs = Math.max(0, config.debounceMs | 0);
		if (debounceMs > 0) {
			const cancelled = await new Promise<boolean>(resolve => {
				const timer = setTimeout(() => resolve(false), debounceMs);
				const sub = token.onCancellationRequested(() => {
					clearTimeout(timer);
					resolve(true);
					sub.dispose();
				});
				abort.signal.addEventListener('abort', () => {
					clearTimeout(timer);
					resolve(true);
					sub.dispose();
				});
			});
			if (cancelled || token.isCancellationRequested) {
				cancelSub.dispose();
				if (this.currentAbort === abort) {
					this.currentAbort = undefined;
					this.currentKey = undefined;
					this.statusBar.setLoading(false);
				}
				return undefined;
			}
		}

		this.statusBar.setLoading(true);
		log(
			`requesting completion via ${config.provider} (model=${config.model}, prefixLen=${prefix.length}, suffixLen=${suffix.length})`,
		);

		try {
			const startTime = Date.now();
			const result = await requestCompletion(config, req);
			const elapsed = Date.now() - startTime;
			const text = (result.text || '').trimEnd();
			log(
				`completion response in ${elapsed}ms, raw text length=${
					(result.text || '').length
				}, trimmed length=${text.length}`,
			);
			if (!text) {
				log('skip: model returned empty text');
				return undefined;
			}
			log(
				`returning inline completion (${text.length} chars): ${JSON.stringify(
					text.slice(0, 80),
				)}${text.length > 80 ? '...' : ''}`,
			);
			this.rememberCache(cacheKey, text);
			return [
				new vscode.InlineCompletionItem(
					text,
					new vscode.Range(position, position),
				),
			];
		} catch (err: any) {
			if (
				err?.name === 'AbortError' ||
				err?.message === 'Request was aborted.' ||
				token.isCancellationRequested
			) {
				log('request aborted (user typed or cancelled)');
				return undefined;
			}
			const msg = err?.message ?? String(err);
			log(`request error: ${err?.name || 'Error'}: ${msg}`);
			if (err?.status) log(`HTTP status: ${err.status}`);
			if (err?.response?.data)
				log(
					`response.data: ${JSON.stringify(err.response.data).slice(0, 500)}`,
				);
			this.statusBar.setMessage(`Snow Completion error: ${msg}`);
			console.error('Snow inline completion error:', err);
			return undefined;
		} finally {
			cancelSub.dispose();
			if (this.currentAbort === abort) {
				this.currentAbort = undefined;
				this.currentKey = undefined;
				this.statusBar.setLoading(false);
			}
		}
	}

	private rememberCache(key: string, completion: string): void {
		if (this.cache.size >= MAX_CACHE_SIZE) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}
		this.cache.set(key, {prefixKey: key, completion});
	}
}
