import {
	SpanStatusCode,
	context,
	metrics,
	trace,
	type Attributes,
	type Span,
} from '@opentelemetry/api';
import {Metadata} from '@grpc/grpc-js';
import {OTLPLogExporter as OTLPLogExporterGrpc} from '@opentelemetry/exporter-logs-otlp-grpc';
import {OTLPLogExporter as OTLPLogExporterHttp} from '@opentelemetry/exporter-logs-otlp-http';
import {OTLPMetricExporter as OTLPMetricExporterGrpc} from '@opentelemetry/exporter-metrics-otlp-grpc';
import {OTLPMetricExporter as OTLPMetricExporterHttp} from '@opentelemetry/exporter-metrics-otlp-http';
import {PrometheusExporter} from '@opentelemetry/exporter-prometheus';
import {OTLPTraceExporter as OTLPTraceExporterGrpc} from '@opentelemetry/exporter-trace-otlp-grpc';
import {OTLPTraceExporter as OTLPTraceExporterHttp} from '@opentelemetry/exporter-trace-otlp-http';
import {resourceFromAttributes} from '@opentelemetry/resources';
import {
	BatchLogRecordProcessor,
	ConsoleLogRecordExporter,
	type LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
	ConsoleMetricExporter,
	PeriodicExportingMetricReader,
	type IMetricReader,
} from '@opentelemetry/sdk-metrics';
import {NodeSDK} from '@opentelemetry/sdk-node';
import {
	BatchSpanProcessor,
	ConsoleSpanExporter,
	type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {ATTR_SERVICE_NAME} from '@opentelemetry/semantic-conventions';
import {
	getTelemetryConfig,
	isTelemetryEnabled,
	type TelemetryConfig,
} from '../config/projectSettings.js';

let telemetrySdk: NodeSDK | null = null;
let telemetryStarted = false;
let shutdownRegistered = false;

const METER_NAME = 'snow.telemetry';
const TRACER_NAME = 'snow.telemetry';
const SERVICE_NAME = 'snow-cli';
const OTLP_SIGNAL_PATHS = {
	logs: '/v1/logs',
	metrics: '/v1/metrics',
	traces: '/v1/traces',
} as const;

type OtlpSignal = keyof typeof OTLP_SIGNAL_PATHS;

const requestCounter = metrics
	.getMeter(METER_NAME)
	.createCounter('snow.chat.requests', {
		description: 'Number of Snow chat completion requests',
	});

const tokenCounter = metrics
	.getMeter(METER_NAME)
	.createCounter('snow.chat.tokens', {
		description: 'Number of tokens reported by LLM providers',
	});

const requestDuration = metrics
	.getMeter(METER_NAME)
	.createHistogram('snow.chat.request.duration_ms', {
		description: 'Duration of Snow chat completion requests in milliseconds',
		unit: 'ms',
	});

const toolCounter = metrics
	.getMeter(METER_NAME)
	.createCounter('snow.tool.calls', {
		description: 'Number of Snow tool calls',
	});

const toolDuration = metrics
	.getMeter(METER_NAME)
	.createHistogram('snow.tool.duration_ms', {
		description: 'Duration of Snow tool executions in milliseconds',
		unit: 'ms',
	});

export type TelemetryChatAttributes = {
	provider: string;
	model?: string;
	streaming?: boolean;
	conversationId?: string;
	sessionId?: string;
};

export type TelemetryToolAttributes = {
	toolName: string;
	toolCallId?: string;
	sessionId?: string;
};

export type TelemetryContentPhase =
	| 'request'
	| 'response'
	| 'tool.input'
	| 'tool.output';

export type TelemetryUsage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
	cached_tokens?: number;
};

function normalizeTraceExporter(
	value: string | undefined,
	fallback: TelemetryConfig['tracesExporter'] = 'none',
): TelemetryConfig['tracesExporter'] {
	const normalized = value?.trim().toLowerCase();
	if (
		normalized === 'otlp' ||
		normalized === 'console' ||
		normalized === 'none'
	) {
		return normalized;
	}

	return fallback;
}

function normalizeMetricExporter(
	value: string | undefined,
	fallback: TelemetryConfig['metricsExporter'] = 'none',
): TelemetryConfig['metricsExporter'] {
	const normalized = value?.trim().toLowerCase();
	if (
		normalized === 'otlp' ||
		normalized === 'prometheus' ||
		normalized === 'console' ||
		normalized === 'none'
	) {
		return normalized;
	}

	return fallback;
}

function normalizeLogExporter(
	value: string | undefined,
	fallback: TelemetryConfig['logsExporter'] = 'none',
): TelemetryConfig['logsExporter'] {
	const normalized = value?.trim().toLowerCase();
	if (
		normalized === 'otlp' ||
		normalized === 'console' ||
		normalized === 'none'
	) {
		return normalized;
	}

	return fallback;
}

function normalizeProtocol(
	value: string | undefined,
): TelemetryConfig['otlpProtocol'] {
	const normalized = value?.trim().toLowerCase();
	if (
		normalized === 'grpc' ||
		normalized === 'http/protobuf' ||
		normalized === 'http/json'
	) {
		return normalized;
	}

	return 'grpc';
}

function getEffectiveTelemetryConfig(): TelemetryConfig {
	const settings = getTelemetryConfig();

	return {
		...settings,
		enabled: isTelemetryEnabled(),
		tracesExporter: normalizeTraceExporter(settings.tracesExporter, 'otlp'),
		metricsExporter: normalizeMetricExporter(settings.metricsExporter, 'otlp'),
		logsExporter: normalizeLogExporter(settings.logsExporter, 'none'),
		otlpProtocol: normalizeProtocol(settings.otlpProtocol),
		otlpEndpoint: settings.otlpEndpoint ?? 'http://localhost:4317',
		otlpHeaders: settings.otlpHeaders ?? '',
		injectSessionIdHeader: settings.injectSessionIdHeader ?? false,
	};
}

function parseOtlpHeaders(
	rawHeaders: string | undefined,
	injectSessionIdHeader = false,
	sessionId?: string,
): Record<string, string> {
	const headers = rawHeaders?.trim()
		? rawHeaders
				.split(/[;,\n]/)
				.map(entry => entry.trim())
				.filter(Boolean)
				.reduce<Record<string, string>>((parsedHeaders, entry) => {
					const separatorIndex = entry.indexOf('=');
					if (separatorIndex <= 0) {
						return parsedHeaders;
					}

					const key = entry.slice(0, separatorIndex).trim();
					const value = entry.slice(separatorIndex + 1).trim();
					if (key && value) {
						parsedHeaders[key] = value;
					}

					return parsedHeaders;
				}, {})
		: {};

	if (
		injectSessionIdHeader &&
		sessionId &&
		!Object.keys(headers).some(key => key.toLowerCase() === 'session-id')
	) {
		headers['Session-Id'] = sessionId;
	}

	return headers;
}

function toGrpcMetadata(headers: Record<string, string>): Metadata | undefined {
	const entries = Object.entries(headers);
	if (entries.length === 0) {
		return undefined;
	}

	const metadata = new Metadata();
	for (const [key, value] of entries) {
		metadata.set(key, value);
	}

	return metadata;
}

function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/, '');
}

function getOtlpEndpoint(config: TelemetryConfig, signal: OtlpSignal): string {
	const endpoint = config.otlpEndpoint?.trim() || 'http://localhost:4317';
	const normalizedEndpoint = stripTrailingSlash(endpoint);
	const suffix = OTLP_SIGNAL_PATHS[signal];
	if (normalizedEndpoint.endsWith(suffix)) {
		return normalizedEndpoint;
	}

	return `${normalizedEndpoint}${suffix}`;
}

function isGrpcProtocol(config: TelemetryConfig): boolean {
	return normalizeProtocol(config.otlpProtocol) === 'grpc';
}

function createTraceProcessors(
	config: TelemetryConfig,
	sessionId?: string,
): SpanProcessor[] {
	switch (config.tracesExporter) {
		case 'console': {
			return [new BatchSpanProcessor(new ConsoleSpanExporter())];
		}

		case 'otlp': {
			const headers = parseOtlpHeaders(
				config.otlpHeaders,
				config.injectSessionIdHeader,
				sessionId,
			);
			const exporter = isGrpcProtocol(config)
				? new OTLPTraceExporterGrpc({
						url: getOtlpEndpoint(config, 'traces'),
						metadata: toGrpcMetadata(headers),
				  })
				: new OTLPTraceExporterHttp({
						url: getOtlpEndpoint(config, 'traces'),
						headers,
				  });
			return [new BatchSpanProcessor(exporter)];
		}

		default: {
			return [];
		}
	}
}

function createMetricReaders(
	config: TelemetryConfig,
	sessionId?: string,
): IMetricReader[] {
	switch (config.metricsExporter) {
		case 'console': {
			return [
				new PeriodicExportingMetricReader({
					exporter: new ConsoleMetricExporter(),
				}),
			];
		}

		case 'prometheus': {
			return [new PrometheusExporter()];
		}

		case 'otlp': {
			const headers = parseOtlpHeaders(
				config.otlpHeaders,
				config.injectSessionIdHeader,
				sessionId,
			);
			const exporter = isGrpcProtocol(config)
				? new OTLPMetricExporterGrpc({
						url: getOtlpEndpoint(config, 'metrics'),
						metadata: toGrpcMetadata(headers),
				  })
				: new OTLPMetricExporterHttp({
						url: getOtlpEndpoint(config, 'metrics'),
						headers,
				  });
			return [new PeriodicExportingMetricReader({exporter})];
		}

		default: {
			return [];
		}
	}
}

function createLogProcessors(
	config: TelemetryConfig,
	sessionId?: string,
): LogRecordProcessor[] {
	switch (config.logsExporter) {
		case 'console': {
			return [new BatchLogRecordProcessor(new ConsoleLogRecordExporter())];
		}

		case 'otlp': {
			const headers = parseOtlpHeaders(
				config.otlpHeaders,
				config.injectSessionIdHeader,
				sessionId,
			);
			const exporter = isGrpcProtocol(config)
				? new OTLPLogExporterGrpc({
						url: getOtlpEndpoint(config, 'logs'),
						metadata: toGrpcMetadata(headers),
				  })
				: new OTLPLogExporterHttp({
						url: getOtlpEndpoint(config, 'logs'),
						headers,
				  });
			return [new BatchLogRecordProcessor(exporter)];
		}

		default: {
			return [];
		}
	}
}

function registerShutdown(): void {
	if (shutdownRegistered) {
		return;
	}

	shutdownRegistered = true;
	process.once('beforeExit', () => {
		void shutdownTelemetry();
	});
}

export function initializeTelemetry(sessionId?: string): boolean {
	if (telemetryStarted) {
		return true;
	}

	const config = getEffectiveTelemetryConfig();
	if (!config.enabled) {
		return false;
	}

	try {
		telemetrySdk = new NodeSDK({
			resource: resourceFromAttributes({
				[ATTR_SERVICE_NAME]: SERVICE_NAME,
			}),
			spanProcessors: createTraceProcessors(config, sessionId),
			metricReaders: createMetricReaders(config, sessionId),
			logRecordProcessors: createLogProcessors(config, sessionId),
		});
		telemetrySdk.start();
		telemetryStarted = true;
		registerShutdown();
		return true;
	} catch (error) {
		telemetrySdk = null;
		telemetryStarted = false;
		console.error(
			'[telemetry] Failed to initialize OpenTelemetry:',
			error instanceof Error ? error.message : String(error),
		);
		return false;
	}
}

export async function shutdownTelemetry(): Promise<void> {
	if (!telemetrySdk) {
		return;
	}

	const sdk = telemetrySdk;
	telemetrySdk = null;
	telemetryStarted = false;
	try {
		await sdk.shutdown();
	} catch (error) {
		console.error(
			'[telemetry] Failed to shutdown OpenTelemetry:',
			error instanceof Error ? error.message : String(error),
		);
	}
}

function toSpanAttributes(attributes: TelemetryChatAttributes): Attributes {
	const conversationId = attributes.conversationId ?? attributes.sessionId;
	return {
		'snow.provider': attributes.provider,
		'snow.streaming': attributes.streaming ?? true,
		...(attributes.model ? {'snow.model': attributes.model} : {}),
		...(attributes.sessionId ? {'snow.session_id': attributes.sessionId} : {}),
		...(conversationId ? {'snow.conversation_id': conversationId} : {}),
		'gen_ai.system': attributes.provider,
		'gen_ai.operation.name': 'chat',
		'gen_ai.request.streaming': attributes.streaming ?? true,
		...(attributes.model ? {'gen_ai.request.model': attributes.model} : {}),
		...(conversationId ? {'gen_ai.conversation.id': conversationId} : {}),
	};
}

function toToolSpanAttributes(attributes: TelemetryToolAttributes): Attributes {
	return {
		'snow.tool.name': attributes.toolName,
		'gen_ai.operation.name': 'execute_tool',
		'gen_ai.tool.name': attributes.toolName,
		...(attributes.toolCallId
			? {
					'snow.tool.call_id': attributes.toolCallId,
					'gen_ai.tool.call.id': attributes.toolCallId,
			  }
			: {}),
		...(attributes.sessionId
			? {
					'snow.session_id': attributes.sessionId,
					'snow.conversation_id': attributes.sessionId,
					'gen_ai.conversation.id': attributes.sessionId,
			  }
			: {}),
	};
}

function stringifyTelemetryContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}

	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
}

export function startChatSpan(attributes: TelemetryChatAttributes): {
	span: Span | null;
	startTime: number;
	metricAttributes: Attributes;
} {
	if (!initializeTelemetry(attributes.sessionId)) {
		return {span: null, startTime: Date.now(), metricAttributes: {}};
	}

	const metricAttributes = toSpanAttributes(attributes);
	requestCounter.add(1, metricAttributes);
	const span = trace
		.getTracer(TRACER_NAME)
		.startSpan('snow.chat.completion', {attributes: metricAttributes});
	return {span, startTime: Date.now(), metricAttributes};
}

export function recordChatContent(
	span: Span | null | undefined,
	phase: Extract<TelemetryContentPhase, 'request' | 'response'>,
	content: unknown,
	attributes: Attributes = {},
): void {
	if (!span || !initializeTelemetry()) {
		return;
	}

	const contentText = stringifyTelemetryContent(content);
	span.addEvent(`snow.chat.${phase}`, {
		...attributes,
		'snow.content.phase': phase,
		'snow.content': contentText,
		'snow.content.length': contentText.length,
	});
}

export function startToolSpan(attributes: TelemetryToolAttributes): {
	span: Span | null;
	startTime: number;
	metricAttributes: Attributes;
} {
	if (!initializeTelemetry(attributes.sessionId)) {
		return {span: null, startTime: Date.now(), metricAttributes: {}};
	}

	const metricAttributes = toToolSpanAttributes(attributes);
	toolCounter.add(1, metricAttributes);
	const span = trace
		.getTracer(TRACER_NAME)
		.startSpan('snow.tool.execution', {attributes: metricAttributes});
	return {span, startTime: Date.now(), metricAttributes};
}

export function recordToolContent(
	span: Span | null | undefined,
	phase: Extract<TelemetryContentPhase, 'tool.input' | 'tool.output'>,
	content: unknown,
	attributes: Attributes = {},
): void {
	if (!span || !initializeTelemetry()) {
		return;
	}

	const contentText = stringifyTelemetryContent(content);
	span.addEvent(`snow.${phase}`, {
		...attributes,
		'snow.content.phase': phase,
		'snow.content': contentText,
		'snow.content.length': contentText.length,
	});
}

export function recordChatUsage(
	usage: TelemetryUsage | undefined,
	attributes: Attributes = {},
	span?: Span | null,
): void {
	if (!usage || !initializeTelemetry()) {
		return;
	}

	const usageAttributes: Attributes = {
		...attributes,
		...(usage.prompt_tokens !== undefined
			? {'gen_ai.usage.input_tokens': usage.prompt_tokens}
			: {}),
		...(usage.completion_tokens !== undefined
			? {'gen_ai.usage.output_tokens': usage.completion_tokens}
			: {}),
		...(usage.total_tokens !== undefined
			? {'snow.usage.total_tokens': usage.total_tokens}
			: {}),
		...(usage.cache_creation_input_tokens !== undefined
			? {
					'snow.usage.cache_creation_input_tokens':
						usage.cache_creation_input_tokens,
			  }
			: {}),
		...(usage.cache_read_input_tokens !== undefined
			? {'snow.usage.cache_read_input_tokens': usage.cache_read_input_tokens}
			: {}),
		...(usage.cached_tokens !== undefined
			? {'snow.usage.cached_tokens': usage.cached_tokens}
			: {}),
	};

	span?.addEvent('gen_ai.usage', usageAttributes);
	for (const [key, value] of Object.entries(usageAttributes)) {
		if (typeof value === 'number') {
			span?.setAttribute(key, value);
		}
	}

	const tokenTypes: Array<[string, number | undefined]> = [
		['prompt', usage.prompt_tokens],
		['completion', usage.completion_tokens],
		['total', usage.total_tokens],
		['cache_creation', usage.cache_creation_input_tokens],
		['cache_read', usage.cache_read_input_tokens],
		['cached', usage.cached_tokens],
	];

	for (const [type, value] of tokenTypes) {
		if (value && value > 0) {
			tokenCounter.add(value, {...attributes, 'snow.token.type': type});
		}
	}
}

export function endChatSpan(
	span: Span | null,
	startTime: number,
	attributes: Attributes = {},
	error?: unknown,
): void {
	if (!span) {
		return;
	}

	if (error) {
		span.recordException(error as Error);
		span.setStatus({
			code: SpanStatusCode.ERROR,
			message: error instanceof Error ? error.message : String(error),
		});
	} else {
		span.setStatus({code: SpanStatusCode.OK});
	}

	requestDuration.record(Date.now() - startTime, attributes);
	context.with(trace.setSpan(context.active(), span), () => span.end());
}

export function endToolSpan(
	span: Span | null,
	startTime: number,
	attributes: Attributes = {},
	error?: unknown,
): void {
	if (!span) {
		return;
	}

	if (error) {
		span.recordException(error as Error);
		span.setStatus({
			code: SpanStatusCode.ERROR,
			message: error instanceof Error ? error.message : String(error),
		});
	} else {
		span.setStatus({code: SpanStatusCode.OK});
	}

	toolDuration.record(Date.now() - startTime, attributes);
	context.with(trace.setSpan(context.active(), span), () => span.end());
}

export function isTelemetryActive(): boolean {
	return telemetryStarted || getEffectiveTelemetryConfig().enabled === true;
}
