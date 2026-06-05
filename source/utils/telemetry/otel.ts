import {
	SpanKind,
	SpanStatusCode,
	context,
	metrics,
	trace,
	type Attributes,
	type Context,
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
	DEFAULT_TELEMETRY_SERVICE_NAME,
	getTelemetryConfig,
	isTelemetryEnabled,
	type TelemetryConfig,
} from '../config/projectSettings.js';

let telemetrySdk: NodeSDK | null = null;
let telemetryStarted = false;
let shutdownRegistered = false;

const METER_NAME = 'snow.telemetry';
const TRACER_NAME = 'snow.telemetry';
const DEFAULT_WORKFLOW_NAME = 'snow.cli.workflow';
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
	parentContext?: Context;
};

export type TelemetryToolAttributes = {
	toolName: string;
	toolCallId?: string;
	sessionId?: string;
	conversationId?: string;
	parentContext?: Context;
};

export type TelemetryTurnAttributes = {
	sessionId?: string;
	conversationId?: string;
	turnId?: string;
	model?: string;
	requestMethod?: string;
	planMode?: boolean;
	vulnerabilityHuntingMode?: boolean;
	teamMode?: boolean;
	parentContext?: Context;
};

export type TelemetryWorkflowAttributes = {
	name?: string;
	sessionId?: string;
	conversationId?: string;
	userId?: string;
	parentContext?: Context;
};

export type TelemetryAgentAttributes = {
	agentId?: string;
	agentName: string;
	instanceId?: string;
	sessionId?: string;
	conversationId?: string;
	spawnDepth?: number;
	parentContext?: Context;
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
		serviceName: settings.serviceName?.trim() || DEFAULT_TELEMETRY_SERVICE_NAME,
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
			// Keep resource attributes minimal. The default process detector records
			// process.command_args, which can include full headless --ask prompts.
			autoDetectResources: false,
			resource: resourceFromAttributes({
				[ATTR_SERVICE_NAME]:
					config.serviceName ?? DEFAULT_TELEMETRY_SERVICE_NAME,
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

function getConversationId(attributes: {
	conversationId?: string;
	sessionId?: string;
}): string | undefined {
	return attributes.conversationId ?? attributes.sessionId;
}

function getSessionId(attributes: {
	conversationId?: string;
	sessionId?: string;
}): string | undefined {
	return attributes.sessionId ?? attributes.conversationId;
}

function getParentContext(parentContext?: Context): Context {
	return parentContext ?? context.active();
}

function toSessionAttributes(attributes: {
	conversationId?: string;
	sessionId?: string;
}): Attributes {
	const conversationId = getConversationId(attributes);
	const sessionId = getSessionId(attributes);

	return {
		...(sessionId
			? {
					'snow.session_id': sessionId,
					'session.id': sessionId,
					'langfuse.session.id': sessionId,
			  }
			: {}),
		...(conversationId
			? {
					'snow.conversation_id': conversationId,
					'gen_ai.conversation.id': conversationId,
					'langfuse.trace.metadata.conversation_id': conversationId,
			  }
			: {}),
	};
}

function toSpanAttributes(attributes: TelemetryChatAttributes): Attributes {
	return {
		...toSessionAttributes(attributes),
		'snow.provider': attributes.provider,
		'snow.streaming': attributes.streaming ?? true,
		...(attributes.model ? {'snow.model': attributes.model} : {}),
		'gen_ai.provider.name': attributes.provider,
		'gen_ai.operation.name': 'chat',
		'gen_ai.request.stream': attributes.streaming ?? true,
		...(attributes.model
			? {
					'gen_ai.request.model': attributes.model,
					'gen_ai.response.model': attributes.model,
					'langfuse.observation.model.name': attributes.model,
			  }
			: {}),
		'langfuse.observation.type': 'generation',
		'langfuse.observation.metadata.provider': attributes.provider,
	};
}

function toToolSpanAttributes(attributes: TelemetryToolAttributes): Attributes {
	return {
		...toSessionAttributes(attributes),
		'snow.tool.name': attributes.toolName,
		'gen_ai.operation.name': 'execute_tool',
		'gen_ai.tool.name': attributes.toolName,
		'gen_ai.tool.type': 'function',
		'langfuse.observation.type': 'span',
		'langfuse.observation.metadata.snow_observation_type': 'tool',
		'langfuse.observation.metadata.tool_name': attributes.toolName,
		...(attributes.toolCallId
			? {
					'snow.tool.call_id': attributes.toolCallId,
					'gen_ai.tool.call.id': attributes.toolCallId,
					'langfuse.observation.metadata.tool_call_id': attributes.toolCallId,
			  }
			: {}),
	};
}

function toTurnSpanAttributes(attributes: TelemetryTurnAttributes): Attributes {
	return {
		...toSessionAttributes(attributes),
		'langfuse.trace.name': 'snow.cli.turn',
		'langfuse.trace.tags': ['snow-cli', 'interactive'],
		'snow.trace.schema_version': '2026-06-04',
		'snow.turn.id': attributes.turnId ?? 'unknown',
		'snow.mode.plan': attributes.planMode ?? false,
		'snow.mode.vulnerability_hunting':
			attributes.vulnerabilityHuntingMode ?? false,
		'snow.mode.team': attributes.teamMode ?? false,
		...(attributes.turnId
			? {'langfuse.trace.metadata.turn_id': attributes.turnId}
			: {}),
		...(attributes.model
			? {
					'snow.model': attributes.model,
					'langfuse.trace.metadata.model': attributes.model,
			  }
			: {}),
		...(attributes.requestMethod
			? {
					'snow.request_method': attributes.requestMethod,
					'langfuse.trace.metadata.request_method': attributes.requestMethod,
			  }
			: {}),
	};
}

function toWorkflowSpanAttributes(
	attributes: TelemetryWorkflowAttributes,
): Attributes {
	const workflowName = attributes.name ?? DEFAULT_WORKFLOW_NAME;

	return {
		...toSessionAttributes(attributes),
		'langfuse.trace.name': workflowName,
		'langfuse.trace.tags': ['snow-cli', 'workflow', 'compact'],
		'snow.workflow.name': workflowName,
		'snow.workflow.type': 'compact',
		'snow.trace.schema_version': '2026-06-04',
		...(attributes.userId
			? {
					'snow.user.id': attributes.userId,
					'langfuse.user.id': attributes.userId,
					'langfuse.trace.metadata.user_id': attributes.userId,
			  }
			: {}),
	};
}

function toAgentSpanAttributes(
	attributes: TelemetryAgentAttributes,
): Attributes {
	return {
		...toSessionAttributes(attributes),
		'snow.agent.name': attributes.agentName,
		'gen_ai.operation.name': 'invoke_agent',
		'gen_ai.agent.name': attributes.agentName,
		'langfuse.observation.type': 'span',
		'langfuse.observation.metadata.snow_observation_type': 'agent',
		'langfuse.observation.metadata.agent_name': attributes.agentName,
		'langfuse.observation.metadata.is_subagent': true,
		...(attributes.agentId
			? {
					'snow.agent.id': attributes.agentId,
					'gen_ai.agent.id': attributes.agentId,
					'langfuse.observation.metadata.agent_id': attributes.agentId,
			  }
			: {}),
		...(attributes.instanceId
			? {
					'snow.agent.instance_id': attributes.instanceId,
					'langfuse.observation.metadata.agent_instance_id':
						attributes.instanceId,
			  }
			: {}),
		...(attributes.spawnDepth !== undefined
			? {
					'snow.agent.spawn_depth': attributes.spawnDepth,
					'langfuse.observation.metadata.agent_spawn_depth':
						attributes.spawnDepth,
			  }
			: {}),
	};
}

const DEFAULT_CONTENT_MAX_LENGTH = 4096;

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

function normalizeContentMaxLength(value: number | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_CONTENT_MAX_LENGTH;
	}

	return Math.max(0, Math.floor(value));
}

function getContentCaptureConfig(): {
	captureContent: boolean;
	contentMaxLength: number;
} {
	const config = getEffectiveTelemetryConfig();
	return {
		captureContent: config.captureContent !== false,
		contentMaxLength: normalizeContentMaxLength(config.contentMaxLength),
	};
}

function captureTelemetryContent(content: unknown): {
	contentText: string;
	truncatedContent: string;
	contentMaxLength: number;
	truncated: boolean;
} {
	const {contentMaxLength} = getContentCaptureConfig();
	const contentText = stringifyTelemetryContent(content);
	const truncatedContent =
		contentMaxLength > 0 ? contentText.slice(0, contentMaxLength) : '';

	return {
		contentText,
		truncatedContent,
		contentMaxLength,
		truncated: truncatedContent.length < contentText.length,
	};
}

function toContentEventAttributes(
	phase: TelemetryContentPhase,
	content: unknown,
	attributes: Attributes,
): Attributes {
	const {captureContent} = getContentCaptureConfig();
	if (!captureContent) {
		return {
			...attributes,
			'snow.content.phase': phase,
			'snow.content.capture_enabled': false,
		};
	}

	const captured = captureTelemetryContent(content);

	return {
		...attributes,
		'snow.content.phase': phase,
		'snow.content.capture_enabled': true,
		'snow.content': captured.truncatedContent,
		'snow.content.length': captured.contentText.length,
		'snow.content.max_length': captured.contentMaxLength,
		'snow.content.truncated': captured.truncated,
	};
}

function setLangfuseContentAttribute(
	span: Span,
	langfuseKey:
		| 'langfuse.trace.input'
		| 'langfuse.trace.output'
		| 'langfuse.observation.input'
		| 'langfuse.observation.output',
	phase: TelemetryContentPhase,
	content: unknown,
): void {
	const {captureContent} = getContentCaptureConfig();
	if (!captureContent) {
		return;
	}

	const captured = captureTelemetryContent(content);
	span.setAttributes({
		[langfuseKey]: captured.truncatedContent,
		'snow.content.capture_enabled': true,
		[`snow.content.${phase}.length`]: captured.contentText.length,
		[`snow.content.${phase}.max_length`]: captured.contentMaxLength,
		[`snow.content.${phase}.truncated`]: captured.truncated,
	});
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
	const spanName = attributes.model ? `chat ${attributes.model}` : 'chat';
	requestCounter.add(1, metricAttributes);
	const span = trace.getTracer(TRACER_NAME).startSpan(
		spanName,
		{
			kind: SpanKind.CLIENT,
			attributes: metricAttributes,
		},
		getParentContext(attributes.parentContext),
	);
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

	span.addEvent(
		`snow.chat.${phase}`,
		toContentEventAttributes(phase, content, attributes),
	);
	setLangfuseContentAttribute(
		span,
		phase === 'request'
			? 'langfuse.observation.input'
			: 'langfuse.observation.output',
		phase,
		content,
	);
}

export function recordTurnContent(
	phase: Extract<TelemetryContentPhase, 'request' | 'response'>,
	content: unknown,
	attributes: Attributes = {},
): void {
	if (!initializeTelemetry()) {
		return;
	}

	const span = trace.getSpan(context.active());
	if (!span) {
		return;
	}

	span.addEvent(
		`snow.turn.${phase}`,
		toContentEventAttributes(phase, content, attributes),
	);
	setLangfuseContentAttribute(
		span,
		phase === 'request' ? 'langfuse.trace.input' : 'langfuse.trace.output',
		phase,
		content,
	);
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
	const span = trace.getTracer(TRACER_NAME).startSpan(
		`execute_tool ${attributes.toolName}`,
		{
			kind: SpanKind.INTERNAL,
			attributes: metricAttributes,
		},
		getParentContext(attributes.parentContext),
	);
	return {span, startTime: Date.now(), metricAttributes};
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export async function withActiveTelemetrySpan<T>(
	span: Span | null | undefined,
	fn: () => Promise<T>,
): Promise<T> {
	if (!span || !initializeTelemetry()) {
		return fn();
	}

	return context.with(trace.setSpan(context.active(), span), fn);
}

export async function withTurnSpan<T>(
	attributes: TelemetryTurnAttributes,
	fn: () => Promise<T>,
): Promise<T> {
	if (!initializeTelemetry(attributes.sessionId)) {
		return fn();
	}

	const spanAttributes = toTurnSpanAttributes(attributes);
	return trace.getTracer(TRACER_NAME).startActiveSpan(
		'snow.cli.turn',
		{
			kind: SpanKind.INTERNAL,
			attributes: spanAttributes,
		},
		getParentContext(attributes.parentContext),
		async span => {
			try {
				const result = await fn();
				span.setStatus({code: SpanStatusCode.OK});
				return result;
			} catch (error) {
				const normalizedError = toError(error);
				span.recordException(normalizedError);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: normalizedError.message,
				});
				throw error;
			} finally {
				span.end();
			}
		},
	);
}

export async function withAgentSpan<T>(
	attributes: TelemetryAgentAttributes,
	fn: () => Promise<T>,
): Promise<T> {
	if (!initializeTelemetry(attributes.sessionId)) {
		return fn();
	}

	const spanAttributes = toAgentSpanAttributes(attributes);
	return trace.getTracer(TRACER_NAME).startActiveSpan(
		`invoke_agent ${attributes.agentName}`,
		{
			kind: SpanKind.INTERNAL,
			attributes: spanAttributes,
		},
		getParentContext(attributes.parentContext),
		async span => {
			try {
				const result = await fn();
				span.setStatus({code: SpanStatusCode.OK});
				return result;
			} catch (error) {
				const normalizedError = toError(error);
				span.recordException(normalizedError);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: normalizedError.message,
				});
				throw error;
			} finally {
				span.end();
			}
		},
	);
}

export async function withCompactSpan<T>(
	attributes: TelemetryWorkflowAttributes,
	fn: () => Promise<T>,
): Promise<T> {
	if (!initializeTelemetry(attributes.sessionId)) {
		return fn();
	}

	const spanName = attributes.name ?? 'snow.cli.compact';
	const spanAttributes = toWorkflowSpanAttributes({
		...attributes,
		name: spanName,
	});

	return trace.getTracer(TRACER_NAME).startActiveSpan(
		spanName,
		{
			kind: SpanKind.INTERNAL,
			attributes: spanAttributes,
		},
		getParentContext(attributes.parentContext),
		async span => {
			try {
				const result = await fn();
				span.setStatus({code: SpanStatusCode.OK});
				return result;
			} catch (error) {
				const normalizedError = toError(error);
				span.recordException(normalizedError);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: normalizedError.message,
				});
				throw error;
			} finally {
				span.end();
			}
		},
	);
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

	span.addEvent(
		`snow.${phase}`,
		toContentEventAttributes(phase, content, attributes),
	);
	setLangfuseContentAttribute(
		span,
		phase === 'tool.input'
			? 'langfuse.observation.input'
			: 'langfuse.observation.output',
		phase,
		content,
	);
}

export function recordChatUsage(
	usage: TelemetryUsage | undefined,
	attributes: Attributes = {},
	span?: Span | null,
): void {
	if (!usage || !initializeTelemetry()) {
		return;
	}

	const cacheReadInputTokens =
		usage.cache_read_input_tokens ?? usage.cached_tokens;
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
					'gen_ai.usage.cache_creation.input_tokens':
						usage.cache_creation_input_tokens,
			  }
			: {}),
		...(cacheReadInputTokens !== undefined
			? {
					'snow.usage.cache_read_input_tokens': cacheReadInputTokens,
					'gen_ai.usage.cache_read.input_tokens': cacheReadInputTokens,
			  }
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
