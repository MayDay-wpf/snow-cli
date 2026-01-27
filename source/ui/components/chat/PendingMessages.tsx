import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';

interface PendingMessage {
	text: string;
	images?: Array<{data: string; mimeType: string}>;
}

interface Props {
	pendingMessages: PendingMessage[];
}

export default function PendingMessages({pendingMessages}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();

	if (pendingMessages.length === 0) {
		return null;
	}

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.warning}
			paddingX={1}
		>
			<Text color={theme.colors.warning} bold>
				{t.chatScreen.pendingMessagesTitle} ({pendingMessages.length})
			</Text>
			{pendingMessages.map((message, index) => (
				<Box key={index} marginLeft={1} marginY={0} flexDirection="column">
					<Box>
						<Text color="blue" bold>
							{index + 1}.
						</Text>
						<Box marginLeft={1}>
							<Text color={theme.colors.menuSecondary}>
								{message.text.length > 60
									? `${message.text.substring(0, 60)}...`
									: message.text}
							</Text>
						</Box>
					</Box>
					{message.images && message.images.length > 0 && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary} dimColor>
								└─{' '}
								{t.chatScreen.pendingMessagesImagesAttached.replace(
									'{count}',
									String(message.images.length),
								)}
							</Text>
						</Box>
					)}
				</Box>
			))}
			<Text color={theme.colors.warning} dimColor>
				{t.chatScreen.pendingMessagesFooter}
			</Text>
			<Text color={theme.colors.warning} dimColor>
				{t.chatScreen.pendingMessagesEscHint}
			</Text>
		</Box>
	);
}
