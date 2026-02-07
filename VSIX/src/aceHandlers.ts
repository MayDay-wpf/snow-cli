import * as vscode from 'vscode';

/**
 * ACE Code Search Handlers
 * Provides Go to Definition, Find References, Get Symbols, and Diagnostics functionality
 */

export type BroadcastFunction = (message: string) => void;

/**
 * Handle Go to Definition request
 */
export async function handleGoToDefinition(
	filePath: string,
	line: number,
	column: number,
	requestId: string,
	broadcast: BroadcastFunction,
): Promise<void> {
	try {
		const uri = vscode.Uri.file(filePath);
		const position = new vscode.Position(line, column);

		// Use VS Code's built-in go to definition
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeDefinitionProvider',
			uri,
			position,
		);

		const results = (definitions || []).map(def => ({
			filePath: def.uri.fsPath,
			line: def.range.start.line,
			column: def.range.start.character,
			endLine: def.range.end.line,
			endColumn: def.range.end.character,
		}));

		// Send response back
		broadcast(
			JSON.stringify({
				type: 'aceGoToDefinitionResult',
				requestId,
				definitions: results,
			}),
		);
	} catch (error) {
		// On error, send empty results
		broadcast(
			JSON.stringify({
				type: 'aceGoToDefinitionResult',
				requestId,
				definitions: [],
			}),
		);
	}
}

/**
 * Handle Find References request
 */
export async function handleFindReferences(
	filePath: string,
	line: number,
	column: number,
	requestId: string,
	broadcast: BroadcastFunction,
): Promise<void> {
	try {
		const uri = vscode.Uri.file(filePath);
		const position = new vscode.Position(line, column);

		// Use VS Code's built-in find references
		const references = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeReferenceProvider',
			uri,
			position,
		);

		const results = (references || []).map(ref => ({
			filePath: ref.uri.fsPath,
			line: ref.range.start.line,
			column: ref.range.start.character,
			endLine: ref.range.end.line,
			endColumn: ref.range.end.character,
		}));

		// Send response back
		broadcast(
			JSON.stringify({
				type: 'aceFindReferencesResult',
				requestId,
				references: results,
			}),
		);
	} catch (error) {
		// On error, send empty results
		broadcast(
			JSON.stringify({
				type: 'aceFindReferencesResult',
				requestId,
				references: [],
			}),
		);
	}
}

/**
 * Handle Get Symbols request
 */
export async function handleGetSymbols(
	filePath: string,
	requestId: string,
	broadcast: BroadcastFunction,
): Promise<void> {
	try {
		const uri = vscode.Uri.file(filePath);

		// Use VS Code's built-in document symbol provider
		const symbols = await vscode.commands.executeCommand<
			vscode.DocumentSymbol[]
		>('vscode.executeDocumentSymbolProvider', uri);

		const flattenSymbols = (symbolList: vscode.DocumentSymbol[]): any[] => {
			const result: any[] = [];
			for (const symbol of symbolList) {
				result.push({
					name: symbol.name,
					kind: vscode.SymbolKind[symbol.kind],
					line: symbol.range.start.line,
					column: symbol.range.start.character,
					endLine: symbol.range.end.line,
					endColumn: symbol.range.end.character,
					detail: symbol.detail,
				});
				if (symbol.children && symbol.children.length > 0) {
					result.push(...flattenSymbols(symbol.children));
				}
			}
			return result;
		};

		const results = symbols ? flattenSymbols(symbols) : [];

		// Send response back
		broadcast(
			JSON.stringify({
				type: 'aceGetSymbolsResult',
				requestId,
				symbols: results,
			}),
		);
	} catch (error) {
		// On error, send empty results
		broadcast(
			JSON.stringify({
				type: 'aceGetSymbolsResult',
				requestId,
				symbols: [],
			}),
		);
	}
}

/**
 * Handle Get Diagnostics request
 */
export function handleGetDiagnostics(
	filePath: string,
	requestId: string,
	broadcast: BroadcastFunction,
): void {
	// Get diagnostics for the file
	const uri = vscode.Uri.file(filePath);
	const diagnostics = vscode.languages.getDiagnostics(uri);

	// Convert to simpler format
	const simpleDiagnostics = diagnostics.map(d => ({
		message: d.message,
		severity: ['error', 'warning', 'info', 'hint'][d.severity],
		line: d.range.start.line,
		character: d.range.start.character,
		source: d.source,
		code: d.code,
	}));

	// Send response back to all connected clients
	broadcast(
		JSON.stringify({
			type: 'diagnostics',
			requestId,
			diagnostics: simpleDiagnostics,
		}),
	);
}
