import React from 'react';
import {Box, Text} from 'ink';
import {useI18n} from '../../../i18n/index.js';

// Get platform-specific paste key
const getPasteKey = () => {
	return process.platform === 'darwin' ? 'Ctrl+V' : 'Alt+V';
};

export default function HelpPanel() {
	const pasteKey = getPasteKey();
	const {t} = useI18n();

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
					{t.helpPanel.title}
				</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="yellow">
					{t.helpPanel.textEditingTitle}
				</Text>
				<Text> • {t.helpPanel.deleteToStart}</Text>
				<Text> • {t.helpPanel.deleteToEnd}</Text>
				<Text>
					{' '}
					• {t.helpPanel.pasteImages.replace('{pasteKey}', pasteKey)}
				</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="cyan">
					{t.helpPanel.readlineTitle}
				</Text>
				<Text> • {t.helpPanel.moveToLineStart}</Text>
				<Text> • {t.helpPanel.moveToLineEnd}</Text>
				<Text> • {t.helpPanel.forwardWord}</Text>
				<Text> • {t.helpPanel.backwardWord}</Text>
				<Text> • {t.helpPanel.deleteToLineEnd}</Text>
				<Text> • {t.helpPanel.deleteToLineStart}</Text>
				<Text> • {t.helpPanel.deleteWord}</Text>
				<Text> • {t.helpPanel.deleteChar}</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="green">
					{t.helpPanel.quickAccessTitle}
				</Text>
				<Text> • {t.helpPanel.insertFiles}</Text>
				<Text> • {t.helpPanel.searchContent}</Text>
				<Text> • {t.helpPanel.selectAgent}</Text>
				<Text> • {t.helpPanel.showCommands}</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="yellow">
					{t.helpPanel.bashModeTitle}
				</Text>
				<Text> • {t.helpPanel.bashModeTrigger}</Text>
				<Text dimColor> {t.helpPanel.bashModeDesc}</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="blue">
					{t.helpPanel.navigationTitle}
				</Text>
				<Text> • {t.helpPanel.navigateHistory}</Text>
				<Text> • {t.helpPanel.selectItem}</Text>
				<Text> • {t.helpPanel.cancelClose}</Text>
				<Text> • {t.helpPanel.toggleYolo}</Text>
			</Box>

			<Box flexDirection="column">
				<Text bold color="magenta">
					{t.helpPanel.tipsTitle}
				</Text>
				<Text> • {t.helpPanel.tipUseHelp}</Text>
				<Text> • {t.helpPanel.tipShowCommands}</Text>
				<Text> • {t.helpPanel.tipInterrupt}</Text>
			</Box>

			<Box marginTop={1}>
				<Text dimColor color="gray">
					{t.helpPanel.closeHint}
				</Text>
			</Box>
		</Box>
	);
}
