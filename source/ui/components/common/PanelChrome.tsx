import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';

type PanelChromeProps = {
	title: string;
	subtitle?: string;
	hint?: string;
	loading?: boolean;
	loadingLabel?: string;
	error?: string | null;
	width?: number;
	children?: React.ReactNode;
	/** When false, omit outer border (inline panels). Default true. */
	bordered?: boolean;
};

/**
 * Shared panel shell: rounded border, title row, loading/error states, footer hint.
 */
export function PanelChrome({
	title,
	subtitle,
	hint,
	loading,
	loadingLabel,
	error,
	width,
	children,
	bordered = true,
}: PanelChromeProps) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const tp = (t as any).panelChrome || {};
	const resolvedLoading =
		loadingLabel || tp.loading || t.workingDirectoryPanel?.loading || 'Loading…';
	const escHint = hint || tp.escHint || t.chatScreen?.pressEscToClose;

	if (loading) {
		return (
			<Box
				borderStyle={bordered ? 'round' : undefined}
				borderColor={theme.colors.menuInfo}
				paddingX={2}
				width={width}
			>
				<Text color={theme.colors.menuSecondary}>
					<Spinner type="dots" /> {resolvedLoading}
				</Text>
			</Box>
		);
	}

	if (error) {
		return (
			<Box
				borderStyle={bordered ? 'round' : undefined}
				borderColor={theme.colors.error}
				paddingX={2}
				width={width}
			>
				<Text color={theme.colors.error}>{error}</Text>
			</Box>
		);
	}

	return (
		<Box
			borderStyle={bordered ? 'round' : undefined}
			borderColor={theme.colors.menuInfo}
			paddingX={2}
			paddingY={bordered ? 1 : 0}
			flexDirection="column"
			width={width}
		>
			<Box>
				<Text color={theme.colors.menuInfo} bold>
					{title}
				</Text>
				{subtitle ? (
					<Text color={theme.colors.menuSecondary} dimColor>
						{'  '}
						{subtitle}
					</Text>
				) : null}
			</Box>
			{children}
			{escHint ? (
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{escHint}
					</Text>
				</Box>
			) : null}
		</Box>
	);
}

export function PanelLoadingFallback({label}: {label?: string}) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const tp = (t as any).panelChrome || {};
	const text = label || tp.loading || 'Loading…';
	return (
		<Box>
			<Text color={theme.colors.menuSecondary}>
				<Spinner type="dots" /> {text}
			</Text>
		</Box>
	);
}

export default PanelChrome;
