import React, {useMemo} from 'react';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import MessageRenderer from './MessageRenderer.js';
import {type Message} from './MessageList.js';

type Props = {
	content: string;
};

export default function UserMessagePreview({content}: Props) {
	const {columns: terminalWidth} = useTerminalSize();

	const message = useMemo<Message>(
		() => ({
			role: 'user',
			content,
		}),
		[content],
	);

	return (
		<MessageRenderer
			message={message}
			terminalWidth={terminalWidth}
			isFirstInGroup={false}
			isLastInGroup={false}
			showThinking={false}
		/>
	);
}
