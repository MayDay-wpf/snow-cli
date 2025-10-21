import React from 'react';
import { Box, Text } from 'ink';

interface ToolResultPreviewProps {
	toolName: string;
	result: string;
	maxLines?: number;
}

/**
 * Display a compact preview of tool execution results
 * Shows a tree-like structure with limited content
 */
export default function ToolResultPreview({ toolName, result, maxLines = 5 }: ToolResultPreviewProps) {
	try {
		// Try to parse JSON result
		const data = JSON.parse(result);

		// Handle different tool types
		if (toolName.startsWith('subagent-')) {
			return renderSubAgentPreview(data, maxLines);
		} else if (toolName === 'filesystem-read') {
			return renderReadPreview(data, maxLines);
		} else if (toolName === 'filesystem-list') {
			return renderListPreview(data, maxLines);
		} else if (toolName === 'filesystem-create' || toolName === 'filesystem-write') {
			return renderCreatePreview(data);
		} else if (toolName === 'filesystem-edit_search') {
			return renderEditSearchPreview(data);
		} else if (toolName === 'websearch-search') {
			return renderWebSearchPreview(data, maxLines);
		} else if (toolName === 'websearch-fetch') {
			return renderWebFetchPreview(data);
		} else if (toolName.startsWith('ace-')) {
			return renderACEPreview(toolName, data, maxLines);
		} else {
			// Generic preview for unknown tools
			return renderGenericPreview(data, maxLines);
		}
	} catch {
		// If not JSON or parsing fails, return null (no preview)
		return null;
	}
}

function renderSubAgentPreview(data: any, maxLines: number) {
	// Sub-agent results have format: { success: boolean, result: string }
	if (!data.result) return null;

	// Split the result into lines
	const lines = data.result.split('\n').filter((line: string) => line.trim());
	const previewLines = lines.slice(0, maxLines);
	const hasMore = lines.length > maxLines;

	return (
		<Box flexDirection="column" marginLeft={2}>
			{previewLines.map((line: string, idx: number) => (
				<Text key={idx} color="gray" dimColor>
					{idx === previewLines.length - 1 && !hasMore ? '└─ ' : '├─ '}
					{line.length > 80 ? line.slice(0, 80) + '...' : line}
				</Text>
			))}
			{hasMore && (
				<Text color="gray" dimColor>
					└─ ... ({lines.length - maxLines} more lines)
				</Text>
			)}
		</Box>
	);
}

function renderReadPreview(data: any, maxLines: number) {
	if (!data.content) return null;

	const lines = data.content.split('\n');
	const previewLines = lines.slice(0, maxLines);
	const hasMore = lines.length > maxLines;

	return (
		<Box flexDirection="column" marginLeft={2}>
			{previewLines.map((line: string, idx: number) => (
				<Text key={idx} color="gray" dimColor>
					{idx === previewLines.length - 1 && !hasMore ? '└─ ' : '├─ '}
					{line.length > 80 ? line.slice(0, 80) + '...' : line}
				</Text>
			))}
			{hasMore && (
				<Text color="gray" dimColor>
					└─ ... ({lines.length - maxLines} more lines, total {data.totalLines} lines)
				</Text>
			)}
		</Box>
	);
}

function renderListPreview(data: string[] | any, maxLines: number) {
	// Handle both array and object response formats
	const files = Array.isArray(data) ? data : (data.files || []);
	if (files.length === 0) return null;

	const previewFiles = files.slice(0, maxLines);
	const hasMore = files.length > maxLines;

	return (
		<Box flexDirection="column" marginLeft={2}>
			{previewFiles.map((file: string, idx: number) => (
				<Text key={idx} color="gray" dimColor>
					{idx === previewFiles.length - 1 && !hasMore ? '└─ ' : '├─ '}
					{file}
				</Text>
			))}
			{hasMore && (
				<Text color="gray" dimColor>
					└─ ... ({files.length - maxLines} more items, total {files.length} items)
				</Text>
			)}
		</Box>
	);
}

function renderACEPreview(toolName: string, data: any, maxLines: number) {
	// Handle ace-text-search results
	if (toolName === 'ace-text-search' || toolName === 'ace-text_search') {
		if (!data || data.length === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No matches found
					</Text>
				</Box>
			);
		}

		const results = Array.isArray(data) ? data : [];
		const previewMatches = results.slice(0, maxLines);
		const hasMore = results.length > maxLines;

		return (
			<Box flexDirection="column" marginLeft={2}>
				{previewMatches.map((match: any, idx: number) => (
					<Text key={idx} color="gray" dimColor>
						{idx === previewMatches.length - 1 && !hasMore ? '└─ ' : '├─ '}
						{match.filePath}:{match.line} - {match.content.slice(0, 60)}
						{match.content.length > 60 ? '...' : ''}
					</Text>
				))}
				{hasMore && (
					<Text color="gray" dimColor>
						└─ ... ({results.length - maxLines} more matches)
					</Text>
				)}
			</Box>
		);
	}

	// Handle ace-search-symbols results
	if (toolName === 'ace-search-symbols' || toolName === 'ace-search_symbols') {
		const symbols = data.symbols || [];
		if (symbols.length === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No symbols found
					</Text>
				</Box>
			);
		}

		const previewSymbols = symbols.slice(0, maxLines);
		const hasMore = symbols.length > maxLines;

		return (
			<Box flexDirection="column" marginLeft={2}>
				{previewSymbols.map((symbol: any, idx: number) => (
					<Text key={idx} color="gray" dimColor>
						{idx === previewSymbols.length - 1 && !hasMore ? '└─ ' : '├─ '}
						{symbol.type} {symbol.name} - {symbol.filePath}:{symbol.line}
					</Text>
				))}
				{hasMore && (
					<Text color="gray" dimColor>
						└─ ... ({data.totalResults - maxLines} more symbols)
					</Text>
				)}
			</Box>
		);
	}

	// Handle ace-find-references results
	if (toolName === 'ace-find-references' || toolName === 'ace-find_references') {
		const references = Array.isArray(data) ? data : [];
		if (references.length === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No references found
					</Text>
				</Box>
			);
		}

		const previewRefs = references.slice(0, maxLines);
		const hasMore = references.length > maxLines;

		return (
			<Box flexDirection="column" marginLeft={2}>
				{previewRefs.map((ref: any, idx: number) => (
					<Text key={idx} color="gray" dimColor>
						{idx === previewRefs.length - 1 && !hasMore ? '└─ ' : '├─ '}
						{ref.referenceType} - {ref.filePath}:{ref.line}
					</Text>
				))}
				{hasMore && (
					<Text color="gray" dimColor>
						└─ ... ({references.length - maxLines} more references)
					</Text>
				)}
			</Box>
		);
	}

	// Handle ace-find-definition result
	if (toolName === 'ace-find-definition' || toolName === 'ace-find_definition') {
		if (!data) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ Definition not found
					</Text>
				</Box>
			);
		}

		return (
			<Box flexDirection="column" marginLeft={2}>
				<Text color="gray" dimColor>
					└─ {data.type} {data.name} - {data.filePath}:{data.line}
				</Text>
			</Box>
		);
	}

	// Handle ace-file-outline result
	if (toolName === 'ace-file-outline' || toolName === 'ace-file_outline') {
		const symbols = Array.isArray(data) ? data : [];
		if (symbols.length === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No symbols in file
					</Text>
				</Box>
			);
		}

		const previewSymbols = symbols.slice(0, maxLines);
		const hasMore = symbols.length > maxLines;

		return (
			<Box flexDirection="column" marginLeft={2}>
				{previewSymbols.map((symbol: any, idx: number) => (
					<Text key={idx} color="gray" dimColor>
						{idx === previewSymbols.length - 1 && !hasMore ? '└─ ' : '├─ '}
						{symbol.type} {symbol.name} (line {symbol.line})
					</Text>
				))}
				{hasMore && (
					<Text color="gray" dimColor>
						└─ ... ({symbols.length - maxLines} more symbols)
					</Text>
				)}
			</Box>
		);
	}

	// Handle ace-semantic-search result
	if (toolName === 'ace-semantic-search' || toolName === 'ace-semantic_search') {
		const totalResults = (data.symbols?.length || 0) + (data.references?.length || 0);
		if (totalResults === 0) {
			return (
				<Box marginLeft={2}>
					<Text color="gray" dimColor>
						└─ No results found
					</Text>
				</Box>
			);
		}

		return (
			<Box flexDirection="column" marginLeft={2}>
				<Text color="gray" dimColor>
					├─ Symbols: {data.symbols?.length || 0}
				</Text>
				<Text color="gray" dimColor>
					└─ References: {data.references?.length || 0}
				</Text>
			</Box>
		);
	}

	// Generic ACE tool preview
	return renderGenericPreview(data, maxLines);
}

function renderCreatePreview(data: any) {
	// Simple success message for create/write operations
	return (
		<Box marginLeft={2}>
			<Text color="gray" dimColor>
				└─ {data.message || data}
			</Text>
		</Box>
	);
}

function renderEditSearchPreview(data: any) {
	// For edit_search, show only key metadata, exclude searchContent and replaceContent
	return (
		<Box flexDirection="column" marginLeft={2}>
			{data.message && (
				<Text color="gray" dimColor>
					├─ {data.message}
				</Text>
			)}
			{data.matchLocation && (
				<Text color="gray" dimColor>
					├─ Match: lines {data.matchLocation.startLine}-{data.matchLocation.endLine}
				</Text>
			)}
			{data.totalLines && (
				<Text color="gray" dimColor>
					└─ Total lines: {data.totalLines}
				</Text>
			)}
		</Box>
	);
}

function renderWebSearchPreview(data: any, maxLines: number) {
	if (!data.results || data.results.length === 0) {
		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ No search results found for "{data.query}"
				</Text>
			</Box>
		);
	}

	const previewResults = data.results.slice(0, maxLines);
	const hasMore = data.results.length > maxLines;

	return (
		<Box flexDirection="column" marginLeft={2}>
			<Text color="cyan" dimColor>
				├─ Query: {data.query}
			</Text>
			<Text color="cyan" dimColor>
				├─ Found {data.totalResults} results
			</Text>
			{previewResults.map((result: any, idx: number) => (
				<Box key={idx} flexDirection="column">
					<Text color="gray" dimColor>
						{idx === previewResults.length - 1 && !hasMore ? '└─ ' : '├─ '}
						[{idx + 1}] {result.title.slice(0, 20)}{result.title.length > 20 ? '...' : ''}
					</Text>
					{result.snippet && (
						<Box marginLeft={3}>
							<Text color="gray" dimColor>
								{result.snippet.slice(0, 20)}{result.snippet.length > 20 ? '...' : ''}
							</Text>
						</Box>
					)}
				</Box>
			))}
			{hasMore && (
				<Text color="gray" dimColor>
					└─ ... ({data.results.length - maxLines} more results)
				</Text>
			)}
		</Box>
	);
}

function renderWebFetchPreview(data: any) {
	return (
		<Box flexDirection="column" marginLeft={2}>
			<Text color="cyan" dimColor>
				├─ Page: {data.title || 'Untitled'}
			</Text>
			<Text color="cyan" dimColor>
				├─ URL: {data.url.slice(0, 20)}{data.url.length > 20 ? '...' : ''}
			</Text>
			<Text color="gray" dimColor>
				├─ Content length: {data.textLength} characters
			</Text>
			<Text color="gray" dimColor>
				└─ Preview: {data.contentPreview.slice(0, 20)}{data.contentPreview.length > 20 ? '...' : ''}
			</Text>
		</Box>
	);
}

function renderGenericPreview(data: any, maxLines: number) {
	// For unknown tool types, show first few properties
	const entries = Object.entries(data).slice(0, maxLines);
	if (entries.length === 0) return null;

	return (
		<Box flexDirection="column" marginLeft={2}>
			{entries.map(([key, value], idx) => {
				const valueStr = typeof value === 'string'
					? value.slice(0, 20) + (value.length > 20 ? '...' : '')
					: JSON.stringify(value).slice(0, 60);

				return (
					<Text key={idx} color="gray" dimColor>
						{idx === entries.length - 1 ? '└─ ' : '├─ '}
						{key}: {valueStr}
					</Text>
				);
			})}
		</Box>
	);
}
