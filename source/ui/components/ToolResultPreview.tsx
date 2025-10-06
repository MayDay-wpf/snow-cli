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
		if (toolName === 'filesystem-read') {
			return renderReadPreview(data, maxLines);
		} else if (toolName === 'filesystem-list') {
			return renderListPreview(data, maxLines);
		} else if (toolName === 'filesystem-search') {
			return renderSearchPreview(data, maxLines);
		} else if (toolName === 'filesystem-create' || toolName === 'filesystem-write') {
			return renderCreatePreview(data);
		} else {
			// Generic preview for unknown tools
			return renderGenericPreview(data, maxLines);
		}
	} catch {
		// If not JSON or parsing fails, return null (no preview)
		return null;
	}
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

function renderSearchPreview(data: any, maxLines: number) {
	if (!data.matches || data.matches.length === 0) {
		return (
			<Box marginLeft={2}>
				<Text color="gray" dimColor>
					└─ No matches found (searched {data.searchedFiles} files)
				</Text>
			</Box>
		);
	}

	const previewMatches = data.matches.slice(0, maxLines);
	const hasMore = data.matches.length > maxLines;

	return (
		<Box flexDirection="column" marginLeft={2}>
			{previewMatches.map((match: any, idx: number) => (
				<Text key={idx} color="gray" dimColor>
					{idx === previewMatches.length - 1 && !hasMore ? '└─ ' : '├─ '}
					{match.filePath}:{match.lineNumber} - {match.lineContent.slice(0, 60)}
					{match.lineContent.length > 60 ? '...' : ''}
				</Text>
			))}
			{hasMore && (
				<Text color="gray" dimColor>
					└─ ... ({data.totalMatches - maxLines} more matches)
				</Text>
			)}
		</Box>
	);
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

function renderGenericPreview(data: any, maxLines: number) {
	// For unknown tool types, show first few properties
	const entries = Object.entries(data).slice(0, maxLines);
	if (entries.length === 0) return null;

	return (
		<Box flexDirection="column" marginLeft={2}>
			{entries.map(([key, value], idx) => {
				const valueStr = typeof value === 'string'
					? value.slice(0, 60) + (value.length > 60 ? '...' : '')
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
