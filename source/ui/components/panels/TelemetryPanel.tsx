import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {
	DEFAULT_TELEMETRY_SERVICE_NAME,
	getTelemetryConfig,
	setTelemetryConfig,
	type TelemetryConfig,
} from '../../../utils/config/projectSettings.js';

interface Props {
	onClose: () => void;
}

type FieldKey =
	| 'enabled'
	| 'serviceName'
	| 'tracesExporter'
	| 'metricsExporter'
	| 'logsExporter'
	| 'otlpProtocol'
	| 'otlpEndpoint'
	| 'otlpHeaders'
	| 'injectSessionIdHeader'
	| 'captureContent'
	| 'contentMaxLength';

const FIELD_ORDER: FieldKey[] = [
	'enabled',
	'serviceName',
	'tracesExporter',
	'metricsExporter',
	'logsExporter',
	'otlpProtocol',
	'otlpEndpoint',
	'otlpHeaders',
	'injectSessionIdHeader',
	'captureContent',
	'contentMaxLength',
];

const EXPORTER_OPTIONS = ['otlp', 'console', 'none'] as const;
const METRICS_EXPORTER_OPTIONS = [
	'otlp',
	'prometheus',
	'console',
	'none',
] as const;
const PROTOCOL_OPTIONS = ['grpc', 'http/protobuf', 'http/json'] as const;
const MIN_VISIBLE_FIELDS = 4;
const MAX_VISIBLE_FIELDS = 6;

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
		serviceName: config.serviceName?.trim() || DEFAULT_TELEMETRY_SERVICE_NAME,
		tracesExporter: config.tracesExporter ?? 'otlp',
		metricsExporter: config.metricsExporter ?? 'otlp',
		logsExporter: config.logsExporter ?? 'none',
		otlpProtocol: config.otlpProtocol ?? 'grpc',
		otlpEndpoint: config.otlpEndpoint ?? 'http://localhost:4317',
		otlpHeaders: config.otlpHeaders ?? '',
		injectSessionIdHeader: config.injectSessionIdHeader ?? false,
		captureContent: config.captureContent ?? true,
		contentMaxLength: config.contentMaxLength ?? 4096,
	};
}

export const TelemetryPanel: React.FC<Props> = ({onClose}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const {rows} = useTerminalSize();
	const [config, setConfig] = useState<Required<TelemetryConfig>>(() =>
		normalizeConfig(getTelemetryConfig()),
	);
	const [focusIndex, setFocusIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [message, setMessage] = useState('');

	const focusedField = FIELD_ORDER[focusIndex];
	const visibleFieldCount = Math.max(
		MIN_VISIBLE_FIELDS,
		Math.min(MAX_VISIBLE_FIELDS, rows - 8),
	);

	useEffect(() => {
		setConfig(normalizeConfig(getTelemetryConfig()));
	}, []);

	useEffect(() => {
		setScrollOffset(previous => {
			if (focusIndex < previous) {
				return focusIndex;
			}

			if (focusIndex >= previous + visibleFieldCount) {
				return focusIndex - visibleFieldCount + 1;
			}

			return Math.min(
				previous,
				Math.max(0, FIELD_ORDER.length - visibleFieldCount),
			);
		});
	}, [focusIndex, visibleFieldCount]);

	const save = useCallback(() => {
		setTelemetryConfig(normalizeConfig(config));
		setMessage(t.telemetryPanel.savedMessage);
		setTimeout(() => setMessage(''), 2000);
	}, [config, t.telemetryPanel.savedMessage]);

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

					case 'injectSessionIdHeader': {
						return {
							...previous,
							injectSessionIdHeader: !previous.injectSessionIdHeader,
						};
					}

					case 'captureContent': {
						return {...previous, captureContent: !previous.captureContent};
					}

					default: {
						return previous;
					}
				}
			});
		},
		[focusedField],
	);

	const moveFocus = useCallback((nextIndex: number) => {
		const normalizedIndex =
			(nextIndex + FIELD_ORDER.length) % FIELD_ORDER.length;
		setFocusIndex(normalizedIndex);
	}, []);

	useInput((input, key) => {
		if (key.escape) {
			save();
			onClose();
			return;
		}

		if (key.upArrow) {
			moveFocus(focusIndex - 1);
			return;
		}

		if (key.downArrow) {
			moveFocus(focusIndex + 1);
			return;
		}

		if (key.leftArrow) {
			cycleFocused(-1);
			return;
		}

		if (key.return) {
			// Enter no longer saves; just cycle to the next field
			if (
				focusedField !== 'serviceName' &&
				focusedField !== 'otlpEndpoint' &&
				focusedField !== 'otlpHeaders' &&
				focusedField !== 'contentMaxLength'
			) {
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
				key: 'serviceName' as const,
				label: t.telemetryPanel.serviceName,
				value: config.serviceName,
				hint: t.telemetryPanel.hintServiceName,
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
			{
				key: 'injectSessionIdHeader' as const,
				label: t.telemetryPanel.injectSessionIdHeader,
				value: config.injectSessionIdHeader ? 'on' : 'off',
				hint: t.telemetryPanel.hintInjectSessionIdHeader,
			},
			{
				key: 'captureContent' as const,
				label: t.telemetryPanel.captureContent,
				value: config.captureContent ? 'on' : 'off',
				hint: t.telemetryPanel.hintCaptureContent,
			},
			{
				key: 'contentMaxLength' as const,
				label: t.telemetryPanel.contentMaxLength,
				value: String(config.contentMaxLength),
				hint: t.telemetryPanel.hintContentMaxLength,
			},
		],
		[config, t.telemetryPanel],
	);

	const visibleFields = fields.slice(
		scrollOffset,
		scrollOffset + visibleFieldCount,
	);
	const hiddenAboveCount = scrollOffset;
	const hiddenBelowCount = Math.max(
		0,
		fields.length - scrollOffset - visibleFieldCount,
	);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={2}
			paddingY={0}
		>
			<Text color={theme.colors.menuInfo} bold>
				{t.telemetryPanel.title}
				{fields.length > visibleFieldCount
					? ` (${focusIndex + 1}/${fields.length})`
					: ''}
			</Text>
			<Text color={theme.colors.menuSecondary} dimColor>
				{t.telemetryPanel.description1}
			</Text>
			<Text color={theme.colors.menuSecondary} dimColor>
				{t.telemetryPanel.description2}
			</Text>

			<Box marginTop={1} flexDirection="column">
				{hiddenAboveCount > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
						↑ {hiddenAboveCount} more above
					</Text>
				)}
				{visibleFields.map((field, index) => {
					const actualIndex = scrollOffset + index;
					const selected = actualIndex === focusIndex;
					const editable =
						field.key === 'serviceName' ||
						field.key === 'otlpEndpoint' ||
						field.key === 'otlpHeaders' ||
						field.key === 'contentMaxLength';
					const valueColor = selected
						? theme.colors.menuInfo
						: theme.colors.text;

					return (
						<Box key={field.key} flexDirection="column">
							<Box>
								<Text
									color={selected ? theme.colors.menuInfo : theme.colors.text}
								>
									{selected ? '❯ ' : '  '}
									<Text
										color={selected ? theme.colors.menuInfo : theme.colors.text}
									>
										{field.label}:
									</Text>
								</Text>
								{selected && editable ? (
									<TextInput
										value={field.value}
										onChange={value =>
											setConfig(previous => ({
												...previous,
												[field.key]:
													field.key === 'contentMaxLength'
														? Math.max(0, Number.parseInt(value, 10) || 0)
														: value,
											}))
										}
										focus
									/>
								) : (
									<Text color={valueColor}>
										{field.value || t.telemetryPanel.empty}
									</Text>
								)}
							</Box>
							{selected && (
								<Box marginLeft={4}>
									<Text color={theme.colors.menuSecondary} dimColor>
										{field.hint}
									</Text>
								</Box>
							)}
						</Box>
					);
				})}
				{hiddenBelowCount > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
						↓ {hiddenBelowCount} more below
					</Text>
				)}
			</Box>

			{message && <Text color={theme.colors.success}>{message}</Text>}
			<Text color={theme.colors.menuSecondary} dimColor>
				{t.telemetryPanel.navigationHint}
			</Text>
		</Box>
	);
};

export default TelemetryPanel;
