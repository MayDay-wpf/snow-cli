import React, {useCallback, useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {
	getSubAgentMaxSpawnDepth,
	setSubAgentMaxSpawnDepth,
} from '../../../utils/config/projectSettings.js';

type Props = {
	visible: boolean;
	onClose: () => void;
};

export default function SubAgentDepthPanel({visible, onClose}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [inputValue, setInputValue] = useState('');
	const [savedDepth, setSavedDepth] = useState<number>(() =>
		getSubAgentMaxSpawnDepth(),
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	useEffect(() => {
		if (!visible) {
			return;
		}

		const currentDepth = getSubAgentMaxSpawnDepth();
		setSavedDepth(currentDepth);
		setInputValue(currentDepth.toString());
		setErrorMessage(null);
		setSuccessMessage(null);
	}, [visible]);

	useEffect(() => {
		if (!errorMessage) {
			return undefined;
		}

		const timer = setTimeout(() => {
			setErrorMessage(null);
		}, 3000);

		return () => clearTimeout(timer);
	}, [errorMessage]);

	useEffect(() => {
		if (!successMessage) {
			return undefined;
		}

		const timer = setTimeout(() => {
			setSuccessMessage(null);
		}, 2000);

		return () => clearTimeout(timer);
	}, [successMessage]);

	const handleSave = useCallback(() => {
		const trimmedValue = inputValue.trim();
		const parsedDepth = Number.parseInt(trimmedValue, 10);

		if (!trimmedValue || !Number.isInteger(parsedDepth) || parsedDepth < 0) {
			setSuccessMessage(null);
			setErrorMessage(t.subAgentDepthPanel.invalidInput);
			return;
		}

		const normalizedDepth = setSubAgentMaxSpawnDepth(parsedDepth);
		setSavedDepth(normalizedDepth);
		setInputValue(normalizedDepth.toString());
		setErrorMessage(null);
		setSuccessMessage(t.subAgentDepthPanel.saveSuccess);
	}, [
		inputValue,
		t.subAgentDepthPanel.invalidInput,
		t.subAgentDepthPanel.saveSuccess,
	]);

	useInput(
		(input, key) => {
			if (key.escape) {
				onClose();
				return;
			}

			if (key.return) {
				handleSave();
				return;
			}

			if (key.backspace || key.delete) {
				setInputValue(prev => prev.slice(0, -1));
				return;
			}

			if (/^[0-9]$/.test(input)) {
				setInputValue(prev => prev + input);
			}
		},
		{isActive: visible},
	);

	if (!visible) {
		return null;
	}

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="cyan"
			paddingX={2}
			paddingY={1}
		>
			<Text color="cyan" bold>
				{t.subAgentDepthPanel.title}
			</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color={theme.colors.menuInfo}>
					{t.subAgentDepthPanel.description}
				</Text>
				<Text>
					{t.subAgentDepthPanel.currentValueLabel}
					<Text color={theme.colors.menuSelected}> {savedDepth}</Text>
				</Text>
			</Box>
			<Box marginTop={1}>
				<Text color={theme.colors.menuInfo}>
					{t.subAgentDepthPanel.inputLabel}
				</Text>
				<Text color={theme.colors.menuSelected}> {inputValue || '0'}</Text>
			</Box>
			{successMessage && (
				<Box marginTop={1}>
					<Alert variant="success">{successMessage}</Alert>
				</Box>
			)}
			{errorMessage && (
				<Box marginTop={1}>
					<Alert variant="error">{errorMessage}</Alert>
				</Box>
			)}
			<Box marginTop={1} flexDirection="column">
				<Text color="gray" dimColor>
					{t.subAgentDepthPanel.hint}
				</Text>
				<Text color="gray" dimColor>
					{t.subAgentDepthPanel.fileHint}
				</Text>
			</Box>
		</Box>
	);
}
