import React from 'react';
import {Box, Text} from 'ink';

type MessageItem = {
	label: string;
	value: string;
	infoText: string;
};

type Translation = {
	chatScreen: {
		historyNavigateHint: string;
		moreAbove: string;
		moreBelow: string;
	};
};

type ThemeColors = {
	menuSelected: string;
	menuNormal: string;
	menuSecondary: string;
	menuInfo: string;
};

type Props = {
	isVisible: boolean;
	messages: MessageItem[];
	selectedIndex: number;
	terminalWidth: number;
	t: Translation;
	colors: ThemeColors;
};

const MAX_VISIBLE_ITEMS = 5;

export default function RollbackMenuPanel({
	isVisible,
	messages,
	selectedIndex,
	terminalWidth,
	t,
	colors,
}: Props) {
	if (!isVisible || messages.length === 0) {
		return null;
	}

	// Calculate scroll window to keep selected index visible
	let startIndex = 0;
	if (messages.length > MAX_VISIBLE_ITEMS) {
		// Keep selected item in the middle of the view when possible
		startIndex = Math.max(0, selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2));
		// Adjust if we're near the end
		startIndex = Math.min(startIndex, messages.length - MAX_VISIBLE_ITEMS);
	}

	const endIndex = Math.min(messages.length, startIndex + MAX_VISIBLE_ITEMS);
	const visibleMessages = messages.slice(startIndex, endIndex);

	const hasMoreAbove = startIndex > 0;
	const hasMoreBelow = endIndex < messages.length;

	const maxLabelWidth = terminalWidth - 4;
	const formatMessageLabel = (label: string): string => {
		// Ensure single line by removing all newlines and control characters
		const singleLineLabel = label
			.replace(/[\r\n\t\v\f\u0000-\u001F\u007F-\u009F]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		// Truncate if too long
		if (singleLineLabel.length > maxLabelWidth) {
			return singleLineLabel.slice(0, maxLabelWidth - 3) + '...';
		}
		return singleLineLabel;
	};

	return (
		<Box flexDirection="column" marginBottom={1} width={terminalWidth - 2}>
			{/* Top border separator */}
			<Box height={1}>
				<Text color={colors.menuSecondary} dimColor>
					{'─'.repeat(terminalWidth - 2)}
				</Text>
			</Box>
			<Box flexDirection="column">
				{/* Top scroll indicator - always reserve space */}
				<Box height={1}>
					{hasMoreAbove ? (
						<Text color={colors.menuSecondary} dimColor>
							{t.chatScreen.moreAbove.replace('{count}', startIndex.toString())}
						</Text>
					) : (
						<Text> </Text>
					)}
				</Box>

				{/* Message list - each item fixed to 1 line */}
				{visibleMessages.map((message, displayIndex) => {
					const actualIndex = startIndex + displayIndex;
					const truncatedLabel = formatMessageLabel(message.label);

					return (
						<Box key={message.value} height={1}>
							<Text
								color={
									actualIndex === selectedIndex
										? colors.menuSelected
										: colors.menuNormal
								}
								bold
								wrap="truncate"
							>
								{actualIndex === selectedIndex ? '❯ ' : '  '}
								{truncatedLabel}
							</Text>
						</Box>
					);
				})}

				{/* Bottom scroll indicator - always reserve space */}
				<Box height={1}>
					{hasMoreBelow ? (
						<Text color={colors.menuSecondary} dimColor>
							{t.chatScreen.moreBelow.replace(
								'{count}',
								(messages.length - endIndex).toString(),
							)}
						</Text>
					) : (
						<Text> </Text>
					)}
				</Box>
			</Box>

			<Box marginBottom={1}>
				<Text color={colors.menuInfo} dimColor>
					{t.chatScreen.historyNavigateHint}
				</Text>
			</Box>
		</Box>
	);
}
