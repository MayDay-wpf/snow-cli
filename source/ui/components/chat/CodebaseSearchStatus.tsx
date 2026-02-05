import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';

export type CodebaseSearchStatusData = {
	isSearching: boolean;
	attempt?: number;
	maxAttempts?: number;
	currentTopN?: number;
	message: string;
	query?: string;
	originalResultsCount?: number;
	suggestion?: string;
};

type Props = {
	status: CodebaseSearchStatusData;
};

// 截断Query字符串，避免过长影响观感
function truncateQuery(query: string, maxLength: number = 50): string {
	if (query.length <= maxLength) {
		return query;
	}
	return query.slice(0, maxLength) + '...';
}

export default function CodebaseSearchStatus({status}: Props) {
	const {theme} = useTheme();

	if (status.isSearching) {
		// 搜索中状态
		return (
			<Box flexDirection="column" paddingLeft={1}>
				<Box flexDirection="row" gap={1}>
					<Text color="cyan">⏏ Codebase Search</Text>
					{status.attempt && (
						<Text color="cyan" dimColor>
							(Attempt {status.attempt}/{status.maxAttempts})
						</Text>
					)}
				</Box>
				<Box flexDirection="column" paddingLeft={2}>
					{/* Show current query */}
					{status.query && (
						<Text color="magenta" dimColor>
							Query: "{truncateQuery(status.query)}"
						</Text>
					)}
					{/* Show original results count if reviewing */}
					{status.originalResultsCount !== undefined && (
						<Text color="yellow" dimColor>
							Found {status.originalResultsCount} results, reviewing with AI...
						</Text>
					)}
					{/* Show basic message if no detailed info yet */}
					{status.originalResultsCount === undefined && (
						<Text color={theme.colors.menuSecondary}>{status.message}</Text>
					)}
				</Box>
			</Box>
		);
	}

	return null;
}
