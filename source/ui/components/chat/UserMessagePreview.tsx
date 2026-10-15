import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';

type Props = {
	content: string;
};

export default function UserMessagePreview({content}: Props) {
	const {theme} = useTheme();

	return (
		<Box marginY={0} paddingX={1}>
			<Text
				color={theme.colors.userMessageText}
				backgroundColor={theme.colors.userMessageBackground}
			>
				{`  ${content}  `}
			</Text>
		</Box>
	);
}

