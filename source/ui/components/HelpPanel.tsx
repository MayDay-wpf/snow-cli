import React from 'react';
import {Box, Text} from 'ink';

// Get platform-specific paste key
const getPasteKey = () => {
	return process.platform === 'darwin' ? 'Ctrl+V' : 'Alt+V';
};

export default function HelpPanel() {
	const pasteKey = getPasteKey();

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="cyan"
			paddingX={2}
			paddingY={1}
		>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					🔰 Keyboard Shortcuts & Help
				</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="yellow">
					📝 Text Editing:
				</Text>
				<Text>  • Ctrl+L - Delete from cursor to start</Text>
				<Text>  • Ctrl+R - Delete from cursor to end</Text>
				<Text>  • {pasteKey} - Paste images from clipboard</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="green">
					🔍 Quick Access:
				</Text>
				<Text>  • @ - Insert files from project</Text>
				<Text>  • @@ - Search file content</Text>
				<Text>  • / - Show available commands</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="blue">
					📋 Navigation:
				</Text>
				<Text>  • ↑/↓ - Navigate command/message history</Text>
				<Text>  • Tab/Enter - Select item in pickers</Text>
				<Text>  • ESC - Cancel/close pickers or interrupt AI response</Text>
				<Text>  • Shift+Tab - Toggle YOLO mode (auto-approve tools)</Text>
			</Box>

			<Box flexDirection="column">
				<Text bold color="magenta">
					💡 Tips:
				</Text>
				<Text>  • Use /help anytime to see this information</Text>
				<Text>  • Type / to see all available commands</Text>
				<Text>  • Press ESC during AI response to interrupt</Text>
			</Box>

			<Box marginTop={1}>
				<Text dimColor color="gray">
					Press ESC to close this help panel
				</Text>
			</Box>
		</Box>
	);
}
