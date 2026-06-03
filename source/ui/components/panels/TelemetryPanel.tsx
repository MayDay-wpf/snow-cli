import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';
import {
	getTelemetryConfig,
	setTelemetryConfig,
	type TelemetryConfig,
} from '../../../utils/config/projectSettings.js';

interface Props {
	onClose: () => void;
}

type FieldKey =
	| 'enabled'
	| 'tracesExporter'
	| 'metricsExporter'
	| 'logsExporter'
	| 'otlpProtocol'
	| 'otlpEndpoint'
	| 'otlpHeaders';

const FIELD_ORDER: FieldKey[] = [
	'enabled',
	'tracesExporter',
	'metricsExporter',
	'logsExporter',
	'otlpProtocol',
	'otlpEndpoint',
	'otlpHeaders',
];

const EXPORTER_OPTIONS = ['otlp', 'console', 'none'] as const;
const METRICS_EXPORTER_OPTIONS = [
	'otlp',
	'prometheus',
	'console',
	'none',
] as const;
const PROTOCOL_OPTIONS = ['grpc', 'http/protobuf', 'http/json'] as const;

function cycleOption<T extends readonly string[]>(
	options: T,
	current: string | undefined,
	direction: 1 | -1,
): T[number] {
	const currentIndex = Math.max(0, options.indexOf(current as T[number]));
	const nextIndex =
		(currentIndex + direction + options.length) % options.length;
	return options[nextIndex] as T[number];
}

function normalizeConfig(config: TelemetryConfig): Required<TelemetryConfig> {
	return {
		enabled: config.enabled ?? false,
		tracesExporter: config.tracesExporter ?? 'otlp',
		metricsExporter: config.metricsExporter ?? 'otlp',
		logsExporter: config.logsExporter ?? 'none',
		otlpProtocol: config.otlpProtocol ?? 'grpc',
		otlpEndpoint: config.otlpEndpoint ?? 'http://localhost:4317',
		otlpHeaders: config.otlpHeaders ?? '',
	};
}

export const TelemetryPanel: React.FC<Props> = ({onClose}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [config, setConfig] = useState<Required<TelemetryConfig>>(() =>
		normalizeConfig(getTelemetryConfig()),
	);
	const [focusIndex, setFocusIndex] = useState(0);
	const [message, setMessage] = useState('');

	const focusedField = FIELD_ORDER[focusIndex];

	useEffect(() => {
		setConfig(normalizeConfig(getTelemetryConfig()));
	}, []);

	const save = useCallback(() => {
		setTelemetryConfig(config);
		setMessage(t.telemetryPanel.savedMessage);
		setTimeout(() => setMessage(''), 2000);
	}, [config]);

	const cycleFocused = useCallback(
		(direction: 1 | -1) => {
			setConfig(previous => {
				switch (focusedField) {
					case 'enabled': {
						return {...previous, enabled: !previous.enabled};
					}

					case 'tracesExporter': {
						return {
							...previous,
							tracesExporter: cycleOption(
								EXPORTER_OPTIONS,
								previous.tracesExporter,
								direction,
							),
						};
					}

					case 'metricsExporter': {
						return {
							...previous,
							metricsExporter: cycleOption(
								METRICS_EXPORTER_OPTIONS,
								previous.metricsExporter,
								direction,
							),
						};
					}

					case 'logsExporter': {
						return {
							...previous,
							logsExporter: cycleOption(
								EXPORTER_OPTIONS,
								previous.logsExporter,
								direction,
							),
						};
					}

					case 'otlpProtocol': {
						return {
							...previous,
							otlpProtocol: cycleOption(
								PROTOCOL_OPTIONS,
								previous.otlpProtocol,
								direction,
							),
						};
					}

					default: {
						return previous;
					}
				}
			});
		},
		[focusedField],
	);

	useInput((input, key) => {
		if (key.escape) {
			save();
			onClose();
			return;
		}

		if (key.upArrow) {
			setFocusIndex(previous =>
				previous === 0 ? FIELD_ORDER.length - 1 : previous - 1,
			);
			return;
		}

		if (key.downArrow) {
			setFocusIndex(previous => (previous + 1) % FIELD_ORDER.length);
			return;
		}

		if (key.leftArrow) {
			cycleFocused(-1);
			return;
		}

		if (key.return) {
			// Enter no longer saves; just cycle to the next field
			if (focusedField !== 'otlpEndpoint' && focusedField !== 'otlpHeaders') {
				cycleFocused(1);
			}
			return;
		}

		if (key.rightArrow) {
			cycleFocused(1);
			return;
		}

		if (input.toLowerCase() === 's') {
			save();
		}
	});

	const fields = useMemo(
		() => [
			{
				key: 'enabled' as const,
				label: t.telemetryPanel.enableTelemetry,
				value: config.enabled ? 'on' : 'off',
				hint: t.telemetryPanel.hintEnabled,
			},
			{
				key: 'tracesExporter' as const,
				label: t.telemetryPanel.tracesExporter,
				value: config.tracesExporter,
				hint: t.telemetryPanel.hintTracesExporter,
			},
			{
				key: 'metricsExporter' as const,
				label: t.telemetryPanel.metricsExporter,
				value: config.metricsExporter,
				hint: t.telemetryPanel.hintMetricsExporter,
			},
			{
				key: 'logsExporter' as const,
				label: t.telemetryPanel.logsExporter,
				value: config.logsExporter,
				hint: t.telemetryPanel.hintLogsExporter,
			},
			{
				key: 'otlpProtocol' as const,
				label: t.telemetryPanel.otlpProtocol,
				value: config.otlpProtocol,
				hint: t.telemetryPanel.hintOtlpProtocol,
			},
			{
				key: 'otlpEndpoint' as const,
				label: t.telemetryPanel.otlpEndpoint,
				value: config.otlpEndpoint,
				hint: t.telemetryPanel.hintOtlpEndpoint,
			},
			{
				key: 'otlpHeaders' as const,
				label: t.telemetryPanel.otlpHeaders,
				value: config.otlpHeaders,
				hint: t.telemetryPanel.hintOtlpHeaders,
			},
		],
		[config],
	);

	return (
		<Box flexDirection="column">
			<Text color={theme.colors.warning} bold>
				{t.telemetryPanel.title}
			</Text>
			<Text color={theme.colors.menuSecondary} dimColor>
				{t.telemetryPanel.description1}
			</Text>
			<Text color={theme.colors.menuSecondary} dimColor>
				{t.telemetryPanel.description2}
			</Text>

			<Box marginTop={1} flexDirection="column">
				{fields.map((field, index) => {
					const selected = index === focusIndex;
					const editable =
						field.key === 'otlpEndpoint' || field.key === 'otlpHeaders';
					return (
						<Box key={field.key} flexDirection="column" marginBottom={1}>
							<Box>
								<Text
									color={
										selected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold={selected}
								>
									{selected ? '> ' : '  '}
									{field.label}:{' '}
								</Text>
								{selected && editable ? (
									<TextInput
										value={field.value}
										onChange={value =>
											setConfig(previous => ({...previous, [field.key]: value}))
										}
										focus
									/>
								) : (
									<Text
										color={
											selected
												? theme.colors.menuSelected
												: theme.colors.menuInfo
										}
									>
										{field.value || t.telemetryPanel.empty}
									</Text>
								)}
							</Box>
							<Text color={theme.colors.menuSecondary} dimColor>
								{field.hint}
							</Text>
						</Box>
					);
				})}
			</Box>

			{message && <Text color={theme.colors.success}>{message}</Text>}
			<Text color={theme.colors.menuSecondary} dimColor>
				{t.telemetryPanel.navigationHint}
			</Text>
		</Box>
	);
};

export default TelemetryPanel;
