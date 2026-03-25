import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// Intentionally kept for backward compatibility fallback, despite deprecation
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {getMCPConfig, type MCPServer} from '../config/apiConfig.js';
import {mcpTools as filesystemTools} from '../../mcp/filesystem.js';
import {mcpTools as terminalTools} from '../../mcp/bash.js';
import {mcpTools as aceCodeSearchTools} from '../../mcp/aceCodeSearch.js';
import {mcpTools as websearchTools} from '../../mcp/websearch.js';
import {mcpTools as ideDiagnosticsTools} from '../../mcp/ideDiagnostics.js';
import {mcpTools as codebaseSearchTools} from '../../mcp/codebaseSearch.js';
import {mcpTools as askUserQuestionTools} from '../../mcp/askUserQuestion.js';
import {mcpTools as schedulerTools} from '../../mcp/scheduler.js';
import {TodoService} from '../../mcp/todo.js';
import {
	mcpTools as notebookTools,
	executeNotebookTool,
} from '../../mcp/notebook.js';
import {
	getMCPTools as getSubAgentTools,
	subAgentService,
} from '../../mcp/subagent.js';
import {
	getTeamMCPTools as getTeamTools,
	teamService,
} from '../../mcp/team.js';
import {
	getMCPTools as getSkillTools,
	executeSkillTool,
} from '../../mcp/skills.js';
import {sessionManager} from '../session/sessionManager.js';
import {
	isBuiltInServiceEnabled,
	getDisabledBuiltInServices,
} from '../config/disabledBuiltInTools.js';
import {getDisabledSkills} from '../config/disabledSkills.js';
import {logger} from '../core/logger.js';
import {resourceMonitor} from '../core/resourceMonitor.js';
import {HookFailedError} from './hookFailedError.js';
import os from 'os';
import path from 'path';

/**
 * Extended Error interface with optional isHookFailure flag
 */
export interface HookError extends Error {
	isHookFailure?: boolean;
}

export interface MCPTool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: any;
	};
}

interface InternalMCPTool {
	name: string;
	description: string;
	inputSchema: any;
}

export interface MCPServiceTools {
	serviceName: string;
	tools: Array<{
		name: string;
		description: string;
		inputSchema: any;
	}>;
	isBuiltIn: boolean;
	connected: boolean;
	error?: string;
	enabled?: boolean;
}

// Cache for MCP tools to avoid reconnecting on every message
interface MCPToolsCache {
	tools: MCPTool[];
	servicesInfo: MCPServiceTools[];
	lastUpdate: number;
	configHash: string;
}

let toolsCache: MCPToolsCache | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Lazy initialization of TODO service to avoid circular dependencies
let todoService: TodoService | null = null;

// 🔥 FIX: Persistent MCP client connections for all external services
// MCP protocol supports multiple calls over same connection - no need to reconnect each time
interface PersistentMCPClient {
	client: Client;
	transport: any;
	lastUsed: number;
}

const persistentClients = new Map<string, PersistentMCPClient>();
const CLIENT_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes idle timeout

/**
 * Get the TODO service instance (lazy initialization)
 * TODO 服务路径与 Session 保持一致，按项目分类存储
 */
export function getTodoService(): TodoService {
	if (!todoService) {
		// 获取当前项目ID，与 Session 路径结构保持一致
		const projectId = sessionManager.getProjectId();
		const basePath = path.join(os.homedir(), '.snow', 'todos', projectId);

		todoService = new TodoService(basePath, () => {
			const session = sessionManager.getCurrentSession();
			return session ? session.id : null;
		});
	}
	return todoService;
}

/**
 * Get all registered service prefixes (synchronous)
 * Used for detecting merged tool names
 * Returns cached service names if available, otherwise returns built-in services
 */
export function getRegisteredServicePrefixes(): string[] {
	// 内置服务前缀（始终可用）
	const builtInPrefixes = [
		'todo-',
		'notebook-',
		'filesystem-',
		'terminal-',
		'ace-',
		'websearch-',
		'ide-',
		'codebase-',
		'askuser-',
		'scheduler-',
		'skill-',
		'subagent-',
	];

	// 如果有缓存，从缓存中获取外部 MCP 服务名称
	if (toolsCache?.servicesInfo) {
		const cachedPrefixes = toolsCache.servicesInfo
			.map(s => `${s.serviceName}-`)
			.filter(p => !builtInPrefixes.includes(p));
		return [...builtInPrefixes, ...cachedPrefixes];
	}

	// 尝试从 MCP 配置中获取外部服务名称
	try {
		const mcpConfig = getMCPConfig();
		const externalPrefixes = Object.keys(mcpConfig.mcpServers || {}).map(
			name => `${name}-`,
		);
		return [...builtInPrefixes, ...externalPrefixes];
	} catch {
		return builtInPrefixes;
	}
}

/**
 * Generate a hash of the current MCP configuration and sub-agents
 */
async function generateConfigHash(): Promise<string> {
	try {
		const mcpConfig = getMCPConfig();
		const subAgents = getSubAgentTools(); // Include sub-agents in hash

		// Include skills in hash (both project and global)
		const projectRoot = process.cwd();
		const skillTools = await getSkillTools(projectRoot);

		// 🔥 CRITICAL: Include codebase enabled status in hash
		const {loadCodebaseConfig} = await import('../config/codebaseConfig.js');
		const codebaseConfig = loadCodebaseConfig();

		return JSON.stringify({
			mcpServers: mcpConfig.mcpServers,
			subAgents: subAgents.map(t => t.name), // Only track agent names for hash
			skills: skillTools.map(t => t.name), // Include skill names in hash
			codebaseEnabled: codebaseConfig.enabled, // 🔥 Must include to invalidate cache on enable/disable
			disabledBuiltInServices: getDisabledBuiltInServices(), // Include disabled built-in services in hash
			disabledSkills: getDisabledSkills(), // Include disabled skills in hash
		});
	} catch {
		return '';
	}
}

/**
 * Check if the cache is valid and not expired
 */
async function isCacheValid(): Promise<boolean> {
	if (!toolsCache) return false;

	const now = Date.now();
	const isExpired = now - toolsCache.lastUpdate > CACHE_DURATION;
	const configHash = await generateConfigHash();
	const configChanged = toolsCache.configHash !== configHash;

	return !isExpired && !configChanged;
}

/**
 * Get cached tools or build cache if needed
 */
async function getCachedTools(): Promise<MCPTool[]> {
	if (await isCacheValid()) {
		return toolsCache!.tools;
	}
	await refreshToolsCache();
	return toolsCache!.tools;
}

/**
 * Refresh the tools cache by collecting all available tools
 */
async function refreshToolsCache(): Promise<void> {
	const allTools: MCPTool[] = [];
	const servicesInfo: MCPServiceTools[] = [];

	// Helper: Add a built-in service, respecting disabled state
	// Disabled services are added to servicesInfo (for MCP panel display) but NOT to allTools (AI cannot use them)
	const addBuiltInService = (
		serviceName: string,
		tools: Array<{name: string; description: string; inputSchema: any}>,
		prefix: string,
	) => {
		const enabled = isBuiltInServiceEnabled(serviceName);
		const serviceTools = tools.map(tool => ({
			name: tool.name.replace(`${prefix}-`, ''),
			description: tool.description,
			inputSchema: tool.inputSchema,
		}));

		servicesInfo.push({
			serviceName,
			tools: serviceTools,
			isBuiltIn: true,
			connected: true,
			enabled,
		});

		// Only add to allTools if enabled
		if (enabled) {
			for (const tool of tools) {
				allTools.push({
					type: 'function',
					function: {
						name: tool.name,
						description: tool.description,
						parameters: tool.inputSchema,
					},
				});
			}
		}
	};

	// Add built-in filesystem tools
	addBuiltInService('filesystem', filesystemTools, 'filesystem');

	// Add built-in terminal tools
	addBuiltInService('terminal', terminalTools, 'terminal');

	// Add built-in TODO tools
	const todoSvc = getTodoService();
	await todoSvc.initialize();
	const todoTools = todoSvc.getTools();
	addBuiltInService(
		'todo',
		todoTools.map(t => ({
			name: t.name,
			description: t.description || '',
			inputSchema: t.inputSchema,
		})),
		'todo',
	);

	// Add built-in Notebook tools
	addBuiltInService(
		'notebook',
		notebookTools.map(t => ({
			name: t.name,
			description: t.description || '',
			inputSchema: t.inputSchema,
		})),
		'notebook',
	);

	// Add built-in ACE Code Search tools
	addBuiltInService('ace', aceCodeSearchTools, 'ace');

	// Add built-in Web Search tools
	addBuiltInService('websearch', websearchTools, 'websearch');

	// Add built-in IDE Diagnostics tools
	addBuiltInService('ide', ideDiagnosticsTools, 'ide');

	// Add built-in Ask User Question tools
	const askUserToolsNormalized = askUserQuestionTools.map(tool => ({
		name: tool.function.name,
		description: tool.function.description,
		inputSchema: tool.function.parameters,
	}));
	addBuiltInService('askuser', askUserToolsNormalized, 'askuser');

	// Add built-in Scheduler tools
	const schedulerToolsNormalized = schedulerTools.map(tool => ({
		name: tool.function.name,
		description: tool.function.description,
		inputSchema: tool.function.parameters,
	}));
	addBuiltInService('scheduler', schedulerToolsNormalized, 'scheduler');

	// Add sub-agent tools (dynamically generated from configuration)
	const subAgentTools = getSubAgentTools();

	if (subAgentTools.length > 0) {
		const enabled = isBuiltInServiceEnabled('subagent');
		servicesInfo.push({
			serviceName: 'subagent',
			tools: subAgentTools,
			isBuiltIn: true,
			connected: true,
			enabled,
		});

		if (enabled) {
			for (const tool of subAgentTools) {
				allTools.push({
					type: 'function',
					function: {
						name: `subagent-${tool.name}`,
						description: tool.description,
						parameters: tool.inputSchema,
					},
				});
			}
		}
	}

	// Add team tools (for Agent Team mode)
	const {getTeamMode} = await import('../config/projectSettings.js');
	if (getTeamMode()) {
		const teamTools = getTeamTools();
		if (teamTools.length > 0) {
			const teamEnabled = isBuiltInServiceEnabled('team');
			servicesInfo.push({
				serviceName: 'team',
				tools: teamTools,
				isBuiltIn: true,
				connected: true,
				enabled: teamEnabled !== false,
			});

			if (teamEnabled !== false) {
				for (const tool of teamTools) {
					allTools.push({
						type: 'function',
						function: {
							name: `team-${tool.name}`,
							description: tool.description,
							parameters: tool.inputSchema,
						},
					});
				}
			}
		}
	}

	// Add skill tools (dynamically generated from available skills)
	const projectRoot = process.cwd();
	const skillTools = await getSkillTools(projectRoot);

	if (skillTools.length > 0) {
		const enabled = isBuiltInServiceEnabled('skill');
		servicesInfo.push({
			serviceName: 'skill',
			tools: skillTools,
			isBuiltIn: true,
			connected: true,
			enabled,
		});

		if (enabled) {
			for (const tool of skillTools) {
				allTools.push({
					type: 'function',
					function: {
						name: tool.name,
						description: tool.description,
						parameters: tool.inputSchema,
					},
				});
			}
		}
	}

	// Add built-in Codebase Search tools (conditionally loaded if enabled and index is available)
	try {
		// First check if codebase feature is enabled in config
		const {loadCodebaseConfig} = await import('../config/codebaseConfig.js');
		const codebaseConfig = loadCodebaseConfig();

		// Only proceed if feature is enabled
		if (codebaseConfig.enabled) {
			const projectRoot = process.cwd();
			const dbPath = path.join(
				projectRoot,
				'.snow',
				'codebase',
				'embeddings.db',
			);
			const fs = await import('node:fs');

			// Only add if database file exists
			if (fs.existsSync(dbPath)) {
				// Check if database has data by importing CodebaseDatabase
				const {CodebaseDatabase} = await import(
					'../codebase/codebaseDatabase.js'
				);
				const db = new CodebaseDatabase(projectRoot);
				await db.initialize();
				const totalChunks = db.getTotalChunks();
				db.close();

				if (totalChunks > 0) {
					const codebaseSearchServiceTools = codebaseSearchTools.map(tool => ({
						name: tool.name.replace('codebase-', ''),
						description: tool.description,
						inputSchema: tool.inputSchema,
					}));

					servicesInfo.push({
						serviceName: 'codebase',
						tools: codebaseSearchServiceTools,
						isBuiltIn: true,
						connected: true,
					});

					for (const tool of codebaseSearchTools) {
						allTools.push({
							type: 'function',
							function: {
								name: tool.name,
								description: tool.description,
								parameters: tool.inputSchema,
							},
						});
					}
				}
			}
		}
	} catch (error) {
		// Silently ignore if codebase search tools are not available
		logger.debug('Codebase search tools not available:', error);
	}

	// Add user-configured MCP server tools (probe for availability but don't maintain connections)
	try {
		const mcpConfig = getMCPConfig();
		for (const [serviceName, server] of Object.entries(mcpConfig.mcpServers)) {
			// Skip disabled services
			if (server.enabled === false) {
				servicesInfo.push({
					serviceName,
					tools: [],
					isBuiltIn: false,
					connected: false,
					error: 'Disabled by user',
				});
				continue;
			}

			try {
				const serviceTools = await probeServiceTools(serviceName, server);
				servicesInfo.push({
					serviceName,
					tools: serviceTools,
					isBuiltIn: false,
					connected: true,
				});

				for (const tool of serviceTools) {
					allTools.push({
						type: 'function',
						function: {
							name: `${serviceName}-${tool.name}`,
							description: tool.description,
							parameters: tool.inputSchema,
						},
					});
				}
			} catch (error) {
				servicesInfo.push({
					serviceName,
					tools: [],
					isBuiltIn: false,
					connected: false,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		}
	} catch (error) {
		logger.warn('Failed to load MCP config:', error);
	}

	// Update cache
	toolsCache = {
		tools: allTools,
		servicesInfo,
		lastUpdate: Date.now(),
		configHash: await generateConfigHash(),
	};
}

/**
 * Manually refresh the tools cache (for configuration changes)
 */
export async function refreshMCPToolsCache(): Promise<void> {
	toolsCache = null;
	await refreshToolsCache();
}

/**
 * Reconnect a specific MCP service and update cache
 * @param serviceName - Name of the service to reconnect
 */
export async function reconnectMCPService(serviceName: string): Promise<void> {
	if (!toolsCache) {
		// If no cache, do full refresh
		await refreshToolsCache();
		return;
	}

	// Handle built-in services (they don't need reconnection)
	if (
		serviceName === 'filesystem' ||
		serviceName === 'terminal' ||
		serviceName === 'todo' ||
		serviceName === 'ace' ||
		serviceName === 'websearch' ||
		serviceName === 'codebase' ||
		serviceName === 'askuser' ||
		serviceName === 'scheduler' ||
		serviceName === 'subagent' ||
		serviceName === 'team'
	) {
		return;
	}

	// Get the server config
	const mcpConfig = getMCPConfig();
	const server = mcpConfig.mcpServers[serviceName];

	if (!server) {
		throw new Error(`Service ${serviceName} not found in configuration`);
	}

	// Find and update the service in cache
	const serviceIndex = toolsCache.servicesInfo.findIndex(
		s => s.serviceName === serviceName,
	);

	if (serviceIndex === -1) {
		// Service not in cache, do full refresh
		await refreshToolsCache();
		return;
	}

	try {
		// Try to reconnect to the service
		const serviceTools = await probeServiceTools(serviceName, server);

		// Update service info in cache
		toolsCache.servicesInfo[serviceIndex] = {
			serviceName,
			tools: serviceTools,
			isBuiltIn: false,
			connected: true,
		};

		// Remove old tools for this service from the tools list
		toolsCache.tools = toolsCache.tools.filter(
			tool => !tool.function.name.startsWith(`${serviceName}-`),
		);

		// Add new tools for this service
		for (const tool of serviceTools) {
			toolsCache.tools.push({
				type: 'function',
				function: {
					name: `${serviceName}-${tool.name}`,
					description: tool.description,
					parameters: tool.inputSchema,
				},
			});
		}
	} catch (error) {
		// Update service as failed
		toolsCache.servicesInfo[serviceIndex] = {
			serviceName,
			tools: [],
			isBuiltIn: false,
			connected: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};

		// Remove tools for this service from the tools list
		toolsCache.tools = toolsCache.tools.filter(
			tool => !tool.function.name.startsWith(`${serviceName}-`),
		);
	}
}

/**
 * Clear the tools cache (useful for testing or forcing refresh)
 */
export function clearMCPToolsCache(): void {
	toolsCache = null;
}

/**
 * Collect all available MCP tools from built-in and user-configured services
 * Uses caching to avoid reconnecting on every message
 */
export async function collectAllMCPTools(): Promise<MCPTool[]> {
	return await getCachedTools();
}

/**
 * Get detailed information about all MCP services and their tools
 * Uses cached data when available
 */
export async function getMCPServicesInfo(): Promise<MCPServiceTools[]> {
	if (!(await isCacheValid())) {
		await refreshToolsCache();
	}
	// Ensure toolsCache is not null before accessing
	return toolsCache?.servicesInfo || [];
}

/**
 * Quick probe of MCP service tools without maintaining connections
 * This is used for caching tool definitions
 */
async function probeServiceTools(
	serviceName: string,
	server: MCPServer,
): Promise<InternalMCPTool[]> {
	// HTTP 服务需要更长超时时间
	const timeout = getMCPServerTransportType(server) === 'http' ? 15000 : 5000;
	return await connectAndGetTools(serviceName, server, timeout);
}

const MCP_ENV_VAR_PATTERN = /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function getMCPServerTransportType(server: MCPServer): 'http' | 'stdio' | null {
	if (server.type) {
		// 'local' 是 'stdio' 的别名
		if (server.type === 'local') {
			return 'stdio';
		}
		return server.type as 'http' | 'stdio';
	}

	if (server.url) {
		return 'http';
	}

	if (server.command) {
		return 'stdio';
	}

	return null;
}

function getServerProcessEnv(server: MCPServer): Record<string, string> {
	const processEnv: Record<string, string> = {};

	Object.entries(process.env).forEach(([key, value]) => {
		if (value !== undefined) {
			processEnv[key] = value;
		}
	});

	if (server.env) {
		Object.assign(processEnv, server.env);
	}

	// environment 是 env 的别名，与 env 等价
	if (server.environment) {
		Object.assign(processEnv, server.environment);
	}

	return processEnv;
}

function interpolateMCPConfigValue(
	value: string,
	env: Record<string, string>,
): string {
	return value.replace(MCP_ENV_VAR_PATTERN, (match, braced, simple) => {
		const varName = braced || simple;
		return env[varName] ?? match;
	});
}

function getHttpTransportConfig(server: MCPServer): {
	url: URL;
	requestInit: RequestInit;
} {
	if (!server.url) {
		throw new Error('No URL specified');
	}

	const env = getServerProcessEnv(server);
	const url = new URL(interpolateMCPConfigValue(server.url, env));
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream',
	};

	if (env['MCP_API_KEY']) {
		headers['Authorization'] = `Bearer ${env['MCP_API_KEY']}`;
	}

	if (env['MCP_AUTH_HEADER']) {
		headers['Authorization'] = env['MCP_AUTH_HEADER'];
	}

	if (server.headers) {
		Object.entries(server.headers).forEach(([key, value]) => {
			headers[key] = interpolateMCPConfigValue(value, env);
		});
	}

	return {
		url,
		requestInit: {headers},
	};
}

function createMCPClient(serviceName: string): Client {
	return new Client(
		{
			name: `snow-cli-${serviceName}`,
			version: '1.0.0',
		},
		{
			capabilities: {},
		},
	);
}

function getMCPErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function shouldFallbackToSSE(error: unknown): boolean {
	const errorCode = (error as {code?: unknown})?.code;
	if (typeof errorCode === 'number') {
		return [404, 405, 406, 415, 501].includes(errorCode);
	}

	const message = getMCPErrorMessage(error).toLowerCase();
	return (
		message.includes('error posting to endpoint (http 404)') ||
		message.includes('error posting to endpoint (http 405)') ||
		message.includes('error posting to endpoint (http 406)') ||
		message.includes('error posting to endpoint (http 415)') ||
		message.includes('error posting to endpoint (http 501)') ||
		message.includes('method not allowed') ||
		message.includes('unexpected content type')
	);
}

/**
 * Connect to MCP service and get tools (used for both caching and execution)
 * @param serviceName - Name of the service
 * @param server - Server configuration
 * @param timeoutMs - Timeout in milliseconds (default 10000)
 */
async function connectAndGetTools(
	serviceName: string,
	server: MCPServer,
	timeoutMs: number = 10000,
): Promise<InternalMCPTool[]> {
	let client = createMCPClient(serviceName);
	let transport: any;
	let timeoutId: NodeJS.Timeout | null = null;
	let connectionAborted = false;

	const abortConnection = () => {
		connectionAborted = true;
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	const runWithTimeout = async <T>(
		operation: Promise<T>,
		timeoutMessage: string,
	): Promise<T> => {
		try {
			return await Promise.race([
				operation,
				new Promise<never>((_, reject) => {
					timeoutId = setTimeout(() => {
						abortConnection();
						reject(new Error(timeoutMessage));
					}, timeoutMs);
				}),
			]);
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
		}
	};

	try {
		resourceMonitor.trackMCPConnectionOpened(serviceName);

		const transportType = getMCPServerTransportType(server);
		if (transportType === 'http') {
			const {url, requestInit} = getHttpTransportConfig(server);

			try {
				logger.debug(
					`[MCP] Attempting StreamableHTTP connection to ${serviceName}...`,
				);

				transport = new StreamableHTTPClientTransport(url, {
					requestInit,
				});
				await runWithTimeout(
					client.connect(transport),
					'StreamableHTTP connection timeout',
				);

				logger.debug(
					`[MCP] Successfully connected to ${serviceName} using StreamableHTTP`,
				);
			} catch (httpError) {
				const streamableHttpErrorMessage = getMCPErrorMessage(httpError);

				try {
					await client.close();
				} catch {}

				if (connectionAborted) {
					throw new Error('Connection aborted due to timeout');
				}

				if (!shouldFallbackToSSE(httpError)) {
					throw httpError;
				}

				logger.debug(
					`[MCP] StreamableHTTP is not supported for ${serviceName} (${streamableHttpErrorMessage}), falling back to SSE (deprecated)...`,
				);

				client = createMCPClient(serviceName);
				try {
					transport = new SSEClientTransport(url, {
						requestInit,
					});
					await runWithTimeout(
						client.connect(transport),
						'SSE connection timeout',
					);

					logger.debug(
						`[MCP] Successfully connected to ${serviceName} using SSE (deprecated)`,
					);
				} catch (sseError) {
					throw new Error(
						`StreamableHTTP failed for ${serviceName}: ${streamableHttpErrorMessage}; SSE fallback failed: ${getMCPErrorMessage(
							sseError,
						)}`,
					);
				}
			}
		} else if (transportType === 'stdio') {
			if (!server.command) {
				throw new Error('No command specified');
			}

			transport = new StdioClientTransport({
				command: server.command,
				args: server.args || [],
				env: getServerProcessEnv(server),
				stderr: 'ignore', // 屏蔽第三方MCP服务的stderr输出,避免干扰CLI界面
			});
			await client.connect(transport);
		} else {
			throw new Error('No URL or command specified');
		}

		const toolsResult = await runWithTimeout(
			client.listTools(),
			'ListTools timeout',
		);

		return (
			toolsResult.tools?.map(tool => ({
				name: tool.name,
				description: tool.description || '',
				inputSchema: tool.inputSchema,
			})) || []
		);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		try {
			await Promise.race([
				client.close(),
				new Promise(resolve => setTimeout(resolve, 1000)),
			]);
			resourceMonitor.trackMCPConnectionClosed(serviceName);
		} catch (error) {
			logger.warn(`Failed to close client for ${serviceName}:`, error);
			resourceMonitor.trackMCPConnectionClosed(serviceName);
		}
	}
}

/**
 * Get or create a persistent MCP client for a service
 */
async function getPersistentClient(
	serviceName: string,
	server: MCPServer,
): Promise<Client> {
	const existing = persistentClients.get(serviceName);
	if (existing) {
		existing.lastUsed = Date.now();
		return existing.client;
	}

	let client = createMCPClient(serviceName);
	resourceMonitor.trackMCPConnectionOpened(serviceName);

	let transport: any;
	const transportType = getMCPServerTransportType(server);

	try {
		if (transportType === 'http') {
			const {url, requestInit} = getHttpTransportConfig(server);

			try {
				transport = new StreamableHTTPClientTransport(url, {
					requestInit,
				});
				await client.connect(transport);
			} catch (httpError) {
				const streamableHttpErrorMessage = getMCPErrorMessage(httpError);

				try {
					await client.close();
				} catch {}

				if (!shouldFallbackToSSE(httpError)) {
					throw httpError;
				}

				logger.debug(
					`[MCP] StreamableHTTP is not supported for ${serviceName} (${streamableHttpErrorMessage}), falling back to SSE (deprecated)...`,
				);

				client = createMCPClient(serviceName);
				transport = new SSEClientTransport(url, {
					requestInit,
				});

				try {
					await client.connect(transport);
				} catch (sseError) {
					throw new Error(
						`StreamableHTTP failed for ${serviceName}: ${streamableHttpErrorMessage}; SSE fallback failed: ${getMCPErrorMessage(
							sseError,
						)}`,
					);
				}
			}
		} else if (transportType === 'stdio') {
			if (!server.command) {
				throw new Error('No command specified');
			}

			transport = new StdioClientTransport({
				command: server.command,
				args: server.args || [],
				env: getServerProcessEnv(server),
				stderr: 'pipe', // Persistent services need stderr for process communication
			});
			await client.connect(transport);
		} else {
			throw new Error('No URL or command specified');
		}
	} catch (error) {
		try {
			await client.close();
		} catch {}

		resourceMonitor.trackMCPConnectionClosed(serviceName);
		throw error;
	}

	persistentClients.set(serviceName, {
		client,
		transport,
		lastUsed: Date.now(),
	});

	logger.info(`Created persistent MCP connection for ${serviceName}`);

	return client;
}

/**
 * Close idle persistent connections
 */
export async function cleanupIdleMCPConnections(): Promise<void> {
	const now = Date.now();
	const toClose: string[] = [];

	for (const [serviceName, clientInfo] of persistentClients.entries()) {
		if (now - clientInfo.lastUsed > CLIENT_IDLE_TIMEOUT) {
			toClose.push(serviceName);
		}
	}

	for (const serviceName of toClose) {
		const clientInfo = persistentClients.get(serviceName);
		if (clientInfo) {
			try {
				await clientInfo.client.close();
				resourceMonitor.trackMCPConnectionClosed(serviceName);
				logger.info(`Closed idle MCP connection for ${serviceName}`);
			} catch (error) {
				logger.warn(`Failed to close idle client for ${serviceName}:`, error);
			}
			persistentClients.delete(serviceName);
		}
	}
}

/**
 * Close all persistent MCP connections
 */
export async function closeAllMCPConnections(): Promise<void> {
	for (const [serviceName, clientInfo] of persistentClients.entries()) {
		try {
			await clientInfo.client.close();
			resourceMonitor.trackMCPConnectionClosed(serviceName);
			logger.info(`Closed MCP connection for ${serviceName}`);
		} catch (error) {
			logger.warn(`Failed to close client for ${serviceName}:`, error);
		}
	}
	persistentClients.clear();
}

/**
 * Execute an MCP tool by parsing the prefixed tool name
 * Only connects to the service when actually needed
 */
export async function executeMCPTool(
	toolName: string,
	args: any,
	abortSignal?: AbortSignal,
	onTokenUpdate?: (tokenCount: number) => void,
): Promise<any> {
	// Normalize args: parse stringified JSON parameters for known parameters
	// Some AI models (e.g., Anthropic) may serialize array/object parameters as JSON strings
	// Only parse parameters that are EXPECTED to be arrays/objects (whitelist approach)
	if (args && typeof args === 'object') {
		// Whitelist: parameters that may legitimately be arrays or objects
		const arrayOrObjectParams = [
			'filePath',
			'files',
			'paths',
			'items',
			'options',
		];

		for (const [key, value] of Object.entries(args)) {
			// Only process whitelisted parameters
			if (arrayOrObjectParams.includes(key) && typeof value === 'string') {
				const trimmed = value.trim();
				// Only attempt to parse if it looks like JSON array or object
				if (
					(trimmed.startsWith('[') && trimmed.endsWith(']')) ||
					(trimmed.startsWith('{') && trimmed.endsWith('}'))
				) {
					try {
						const parsed = JSON.parse(value);
						// Type safety: Only replace if parsed result is array or plain object
						if (
							parsed !== null &&
							typeof parsed === 'object' &&
							(Array.isArray(parsed) || parsed.constructor === Object)
						) {
							args[key] = parsed;
						}
					} catch {
						// Keep original value if parsing fails
					}
				}
			}
		}
	}

	let result: any;
	let executionError: Error | null = null;

	try {
		// Handle tool_search meta-tool (progressive tool discovery)
		if (toolName === 'tool_search') {
			const {toolSearchService} = await import('./toolSearchService.js');
			const {textResult} = toolSearchService.search(
				args.query || '',
				args.maxResults,
			);
			return textResult;
		}

		// Find the service name by checking against known services
		let serviceName: string | null = null;
		let actualToolName: string | null = null;

		// Check built-in services first
		if (toolName.startsWith('todo-')) {
			serviceName = 'todo';
			actualToolName = toolName.substring('todo-'.length);
		} else if (toolName.startsWith('notebook-')) {
			serviceName = 'notebook';
			actualToolName = toolName.substring('notebook-'.length);
		} else if (toolName.startsWith('filesystem-')) {
			serviceName = 'filesystem';
			actualToolName = toolName.substring('filesystem-'.length);
		} else if (toolName.startsWith('terminal-')) {
			serviceName = 'terminal';
			actualToolName = toolName.substring('terminal-'.length);
		} else if (toolName.startsWith('ace-')) {
			serviceName = 'ace';
			actualToolName = toolName.substring('ace-'.length);
		} else if (toolName.startsWith('websearch-')) {
			serviceName = 'websearch';
			actualToolName = toolName.substring('websearch-'.length);
		} else if (toolName.startsWith('ide-')) {
			serviceName = 'ide';
			actualToolName = toolName.substring('ide-'.length);
		} else if (toolName.startsWith('codebase-')) {
			serviceName = 'codebase';
			actualToolName = toolName.substring('codebase-'.length);
		} else if (toolName.startsWith('askuser-')) {
			serviceName = 'askuser';
			actualToolName = toolName.substring('askuser-'.length);
		} else if (toolName.startsWith('scheduler-')) {
			serviceName = 'scheduler';
			actualToolName = toolName.substring('scheduler-'.length);
		} else if (toolName.startsWith('skill-')) {
			serviceName = 'skill';
			actualToolName = toolName.substring('skill-'.length);
		} else if (toolName.startsWith('subagent-')) {
			serviceName = 'subagent';
			actualToolName = toolName.substring('subagent-'.length);
		} else if (toolName.startsWith('team-')) {
			serviceName = 'team';
			actualToolName = toolName.substring('team-'.length);
		} else {
			// Check configured MCP services
			try {
				const mcpConfig = getMCPConfig();
				// Sort service names by length descending to match longest first
				const serviceNames = Object.keys(mcpConfig.mcpServers).sort(
					(a, b) => b.length - a.length,
				);
				for (const configuredServiceName of serviceNames) {
					const prefix = `${configuredServiceName}-`;
					if (toolName.startsWith(prefix)) {
						serviceName = configuredServiceName;
						actualToolName = toolName.substring(prefix.length);
						break;
					}
				}
			} catch {
				// Ignore config errors, will handle below
			}
		}

		if (!serviceName || !actualToolName) {
			throw new Error(
				`Invalid tool name format: ${toolName}. Expected format: serviceName-toolName`,
			);
		}

		// Check if built-in service is disabled
		const builtInServices = [
			'todo',
			'notebook',
			'filesystem',
			'terminal',
			'ace',
			'websearch',
			'ide',
			'codebase',
			'askuser',
			'scheduler',
			'skill',
			'subagent',
		];
		if (
			builtInServices.includes(serviceName) &&
			!isBuiltInServiceEnabled(serviceName)
		) {
			throw new Error(
				`Built-in service "${serviceName}" is currently disabled. ` +
					`You can re-enable it in the MCP panel (Tab key to toggle).`,
			);
		}

		if (serviceName === 'todo') {
			// Handle built-in TODO tools (no connection needed)
			result = await getTodoService().executeTool(actualToolName, args);
		} else if (serviceName === 'notebook') {
			// Handle built-in Notebook tools (no connection needed)
			result = await executeNotebookTool(toolName, args);
		} else if (serviceName === 'filesystem') {
			// Handle built-in filesystem tools (no connection needed)
			const {filesystemService} = await import('../../mcp/filesystem.js');

			switch (actualToolName) {
				case 'read':
					// Validate required parameters
					if (!args.filePath) {
						throw new Error(
							`Missing required parameter 'filePath' for filesystem-read tool.
` +
								`Received args: ${JSON.stringify(args, null, 2)}
` +
								`AI Tip: Make sure to provide the 'filePath' parameter as a string.`,
						);
					}
					result = await filesystemService.getFileContent(
						args.filePath,
						args.startLine,
						args.endLine,
					);
					break;
				case 'create':
					// Validate required parameters
					if (!args.filePath) {
						throw new Error(
							`Missing required parameter 'filePath' for filesystem-create tool.
` +
								`Received args: ${JSON.stringify(args, null, 2)}
` +
								`AI Tip: Make sure to provide the 'filePath' parameter as a string.`,
						);
					}
					if (args.content === undefined || args.content === null) {
						throw new Error(
							`Missing required parameter 'content' for filesystem-create tool.
` +
								`Received args: ${JSON.stringify(args, null, 2)}
` +
								`AI Tip: Make sure to provide the 'content' parameter as a string (can be empty string "").`,
						);
					}
					result = await filesystemService.createFile(
						args.filePath,
						args.content,
						args.createDirectories,
					);
					break;
				case 'edit':
					// Validate required parameters
					if (!args.filePath) {
						throw new Error(
							`Missing required parameter 'filePath' for filesystem-edit tool.
` +
								`Received args: ${JSON.stringify(args, null, 2)}
` +
								`AI Tip: Make sure to provide the 'filePath' parameter as a string or array.`,
						);
					}
					if (
						!Array.isArray(args.filePath) &&
						(args.startLine === undefined ||
							args.endLine === undefined ||
							args.newContent === undefined)
					) {
						throw new Error(
							`Missing required parameters for filesystem-edit tool.
` +
								`For single file mode, 'startLine', 'endLine', and 'newContent' are required.
` +
								`Received args: ${JSON.stringify(args, null, 2)}
` +
								`AI Tip: Provide startLine (number), endLine (number), and newContent (string).`,
						);
					}
					result = await filesystemService.editFile(
						args.filePath,
						args.startLine,
						args.endLine,
						args.newContent,
						args.contextLines,
					);
					break;
				case 'edit_search':
					// Validate required parameters
					if (!args.filePath) {
						throw new Error(
							`Missing required parameter 'filePath' for filesystem-edit_search tool.
` +
								`Received args: ${JSON.stringify(args, null, 2)}
` +
								`AI Tip: Make sure to provide the 'filePath' parameter as a string or array.`,
						);
					}
					if (
						!Array.isArray(args.filePath) &&
						(args.searchContent === undefined ||
							args.replaceContent === undefined)
					) {
						throw new Error(
							`Missing required parameters for filesystem-edit_search tool.
` +
								`For single file mode, 'searchContent' and 'replaceContent' are required.
` +
								`Received args: ${JSON.stringify(args, null, 2)}
` +
								`AI Tip: Provide searchContent (string) and replaceContent (string).`,
						);
					}
					result = await filesystemService.editFileBySearch(
						args.filePath,
						args.searchContent,
						args.replaceContent,
						args.occurrence,
						args.contextLines,
					);
					break;

				default:
					throw new Error(`Unknown filesystem tool: ${actualToolName}`);
			}
		} else if (serviceName === 'terminal') {
			// Handle built-in terminal tools (no connection needed)
			const {terminalService} = await import('../../mcp/bash.js');
			const {setTerminalExecutionState} = await import(
				'../../hooks/execution/useTerminalExecutionState.js'
			);

			switch (actualToolName) {
				case 'execute':
					// Validate required workingDirectory parameter
					if (!args.workingDirectory) {
						throw new Error(
							`Missing required parameter 'workingDirectory' for terminal-execute tool.\n` +
								`Received args: ${JSON.stringify(args, null, 2)}\n` +
								`AI Tip: You MUST specify the workingDirectory where the command should run. ` +
								`Use the project root path or a specific directory path.`,
						);
					}

					// Set working directory from AI-provided parameter
					terminalService.setWorkingDirectory(args.workingDirectory);

					// Set execution state to show UI
					setTerminalExecutionState({
						isExecuting: true,
						command: args.command,
						timeout: args.timeout || 30000,
						isBackgrounded: false,
						output: [],
						needsInput: false,
						inputPrompt: null,
					});

					try {
						result = await terminalService.executeCommand(
							args.command,
							args.timeout,
							abortSignal, // Pass abort signal to support ESC key interruption
							args.isInteractive ?? false, // Pass isInteractive flag for AI-determined interactive commands
						);
					} finally {
						// Clear execution state
						setTerminalExecutionState({
							isExecuting: false,
							command: null,
							timeout: null,
							isBackgrounded: false,
							output: [],
							needsInput: false,
							inputPrompt: null,
						});
					}
					break;
				default:
					throw new Error(`Unknown terminal tool: ${actualToolName}`);
			}
		} else if (serviceName === 'ace') {
			// Handle built-in ACE Code Search tools with LSP hybrid support
			const {hybridCodeSearchService} = await import(
				'../../mcp/lsp/HybridCodeSearchService.js'
			);

			switch (actualToolName) {
				case 'search_symbols':
					result = await hybridCodeSearchService.semanticSearch(
						args.query,
						'all',
						args.language,
						args.symbolType,
						args.maxResults,
					);
					break;
				case 'find_definition':
					result = await hybridCodeSearchService.findDefinition(
						args.symbolName,
						args.contextFile,
						args.line,
						args.column,
					);
					break;
				case 'find_references':
					result = await hybridCodeSearchService.findReferences(
						args.symbolName,
						args.maxResults,
					);
					break;
				case 'semantic_search':
					result = await hybridCodeSearchService.semanticSearch(
						args.query,
						args.searchType,
						args.language,
						args.symbolType,
						args.maxResults,
					);
					break;
				case 'file_outline':
					result = await hybridCodeSearchService.getFileOutline(args.filePath, {
						maxResults: args.maxResults,
						includeContext: args.includeContext,
						symbolTypes: args.symbolTypes,
					});
					break;
				case 'text_search':
					result = await hybridCodeSearchService.textSearch(
						args.pattern,
						args.fileGlob,
						args.isRegex,
						args.maxResults,
					);
					break;
				default:
					throw new Error(`Unknown ACE tool: ${actualToolName}`);
			}
		} else if (serviceName === 'websearch') {
			// Handle built-in Web Search tools (no connection needed)
			const {webSearchService} = await import('../../mcp/websearch.js');

			switch (actualToolName) {
				case 'search':
					const searchResponse = await webSearchService.search(
						args.query,
						args.maxResults,
					);
					// Return object directly, will be JSON.stringify in API layer
					result = searchResponse;
					break;
				case 'fetch':
					const pageContent = await webSearchService.fetchPage(
						args.url,
						args.maxLength,
						args.isUserProvided, // Pass isUserProvided parameter
						args.userQuery, // Pass optional userQuery parameter
						abortSignal, // Pass abort signal
						onTokenUpdate, // Pass token update callback
					);
					// Return object directly, will be JSON.stringify in API layer
					result = pageContent;
					break;
				default:
					throw new Error(`Unknown websearch tool: ${actualToolName}`);
			}
		} else if (serviceName === 'ide') {
			// Handle built-in IDE Diagnostics tools (no connection needed)
			const {ideDiagnosticsService} = await import(
				'../../mcp/ideDiagnostics.js'
			);

			switch (actualToolName) {
				case 'get_diagnostics':
					const diagnostics = await ideDiagnosticsService.getDiagnostics(
						args.filePath,
					);
					// Format diagnostics for better readability
					const formatted = ideDiagnosticsService.formatDiagnostics(
						diagnostics,
						args.filePath,
					);
					result = {
						diagnostics,
						formatted,
						summary: `Found ${diagnostics.length} diagnostic(s) in ${args.filePath}`,
					};
					break;
				default:
					throw new Error(`Unknown IDE tool: ${actualToolName}`);
			}
		} else if (serviceName === 'codebase') {
			// Handle built-in Codebase Search tools (no connection needed)
			const {codebaseSearchService} = await import(
				'../../mcp/codebaseSearch.js'
			);

			switch (actualToolName) {
				case 'search':
					result = await codebaseSearchService.search(
						args.query,
						args.topN,
						abortSignal,
					);
					break;
				default:
					throw new Error(`Unknown codebase tool: ${actualToolName}`);
			}
		} else if (serviceName === 'askuser') {
			// Handle Ask User Question tool - validate parameters and trigger user interaction
			switch (actualToolName) {
				case 'ask_question':
					// 参数验证：确保 options 是有效数组
					if (!args.question || typeof args.question !== 'string') {
						return {
							content: [
								{
									type: 'text',
									text: `Error: "question" parameter must be a non-empty string.\n\nReceived: ${JSON.stringify(
										args,
										null,
										2,
									)}\n\nPlease retry with correct parameters.`,
								},
							],
							isError: true,
						};
					}

					if (!Array.isArray(args.options)) {
						return {
							content: [
								{
									type: 'text',
									text: `Error: "options" parameter must be an array of strings.\n\nReceived options: ${JSON.stringify(
										args.options,
									)}\nType: ${typeof args.options}\n\nPlease retry with correct parameters. Example:\n{\n  "question": "Your question here",\n  "options": ["Option 1", "Option 2", "Option 3"]\n}`,
								},
							],
							isError: true,
						};
					}

					if (args.options.length < 2) {
						return {
							content: [
								{
									type: 'text',
									text: `Error: "options" array must contain at least 2 options.\n\nReceived: ${JSON.stringify(
										args.options,
									)}\n\nPlease provide at least 2 options for the user to choose from.`,
								},
							],
							isError: true,
						};
					}

					// 验证 options 数组中的每个元素都是字符串
					const invalidOptions = args.options.filter(
						(opt: any) => typeof opt !== 'string',
					);
					if (invalidOptions.length > 0) {
						return {
							content: [
								{
									type: 'text',
									text: `Error: All options must be strings.\n\nInvalid options: ${JSON.stringify(
										invalidOptions,
									)}\n\nPlease ensure all options are strings.`,
								},
							],
							isError: true,
						};
					}

					// 参数验证通过，抛出 UserInteractionNeededError 触发 UI 组件
					const {UserInteractionNeededError} = await import(
						'../ui/userInteractionError.js'
					);
					throw new UserInteractionNeededError(
						args.question,
						args.options,
						'', //toolCallId will be set by executeToolCall
						false, // multiSelect 已移除，默认支持单选和多选
					);
				default:
					throw new Error(`Unknown askuser tool: ${actualToolName}`);
			}
		} else if (serviceName === 'scheduler') {
			// Handle Scheduler tools - block and wait for countdown
			switch (actualToolName) {
				case 'schedule_task': {
					// Validate parameters
					if (
						typeof args.duration !== 'number' ||
						args.duration < 1 ||
						args.duration > 3600
					) {
						return {
							content: [
								{
									type: 'text',
									text: `Error: "duration" must be a number between 1 and 3600 seconds.\n\nReceived: ${JSON.stringify(
										args.duration,
									)}`,
								},
							],
							isError: true,
						};
					}

					if (!args.description || typeof args.description !== 'string') {
						return {
							content: [
								{
									type: 'text',
									text: `Error: "description" must be a non-empty string.\n\nReceived: ${JSON.stringify(
										args.description,
									)}`,
								},
							],
							isError: true,
						};
					}

					const duration = args.duration;
					const description = args.description;
					const startedAt = new Date().toISOString();

					// Set up UI state for countdown
					const {
						startSchedulerTask,
						updateSchedulerRemainingTime,
						completeSchedulerTask,
						resetSchedulerState,
					} = await import(
						'../../hooks/execution/useSchedulerExecutionState.js'
					);

					// Start the task and show UI
					startSchedulerTask(description, duration);

					// Wait for the specified duration
					let wasAborted = false;
					await new Promise<void>(resolve => {
						const startTime = Date.now();
						const targetTime = startTime + duration * 1000;

						const updateInterval = setInterval(() => {
							const remaining = Math.ceil((targetTime - Date.now()) / 1000);
							if (remaining > 0) {
								updateSchedulerRemainingTime(remaining);
							}
						}, 1000);

						const timeout = setTimeout(() => {
							clearInterval(updateInterval);
							completeSchedulerTask();
							resolve();
						}, duration * 1000);

						// Handle abort signal
						if (abortSignal) {
							const abortHandler = () => {
								wasAborted = true;
								clearInterval(updateInterval);
								clearTimeout(timeout);
								resetSchedulerState();
								resolve();
							};
							abortSignal.addEventListener('abort', abortHandler, {once: true});
						}
					});

					// Return task result
					if (wasAborted) {
						return {
							content: [
								{
									type: 'text',
									text: 'Scheduled task was interrupted by user',
								},
							],
							isError: true,
						};
					}

					const completedAt = new Date().toISOString();

					return {
						success: true,
						description,
						actualDuration: duration,
						startedAt,
						completedAt,
						message: `Scheduled task completed: ${description}`,
					};
				}
				default:
					throw new Error(`Unknown scheduler tool: ${actualToolName}`);
			}
		} else if (serviceName === 'skill') {
			// Handle skill tools (no connection needed)
			const projectRoot = process.cwd();
			result = await executeSkillTool(toolName, args, projectRoot);
		} else if (serviceName === 'subagent') {
			// Handle sub-agent tools
			// actualToolName is the agent ID
			result = await subAgentService.execute({
				agentId: actualToolName,
				prompt: args.prompt,
				abortSignal,
			});
		} else if (serviceName === 'team') {
			// Handle team tools
			result = await teamService.execute({
				toolName: actualToolName,
				args,
				abortSignal,
			});
		} else {
			// Handle user-configured MCP service tools - connect only when needed
			const mcpConfig = getMCPConfig();
			const server = mcpConfig.mcpServers[serviceName];

			if (!server) {
				throw new Error(`MCP service not found: ${serviceName}`);
			}
			// Connect to service and execute tool
			logger.info(
				`Executing tool ${actualToolName} on MCP service ${serviceName}... args: ${
					args ? JSON.stringify(args) : 'none'
				}`,
			);
			result = await executeOnExternalMCPService(
				serviceName,
				server,
				actualToolName,
				args,
			);
		}
	} catch (error) {
		executionError = error instanceof Error ? error : new Error(String(error));
		throw executionError;
	} finally {
		// Execute afterToolCall hook
		try {
			const {unifiedHooksExecutor} = await import('./unifiedHooksExecutor.js');
			const hookResult = await unifiedHooksExecutor.executeHooks(
				'afterToolCall',
				{
					toolName,
					args,
					result,
					error: executionError,
				},
			);

			// Handle hook result based on exit code strategy
			if (hookResult && !hookResult.success) {
				// Find failed command hook
				const commandError = hookResult.results.find(
					(r: any) => r.type === 'command' && !r.success,
				);

				if (commandError && commandError.type === 'command') {
					const {exitCode, command, output, error} = commandError;

					if (exitCode === 1) {
						// Exit code 1: Warning - stderr replaces tool result content
						console.warn(
							`[WARN] afterToolCall hook warning (exitCode: ${exitCode}):
` +
								`output: ${output || '(empty)'}
` +
								`error: ${error || '(empty)'}`,
						);

						const replacedContent =
							error ||
							output ||
							`[afterToolCall Hook Warning] Command: ${command} exited with code 1`;

						if (typeof result === 'string') {
							result = replacedContent;
						} else if (result && typeof result === 'object') {
							if ('content' in result && typeof result.content === 'string') {
								result.content = replacedContent;
							} else {
								result = replacedContent;
							}
						}
					} else if (exitCode >= 2 || exitCode < 0) {
						// Exit code 2+: Critical error - throw structured hook error
						const combinedOutput =
							[output, error].filter(Boolean).join('\n\n') || '(no output)';
						throw new HookFailedError(
							'afterToolCall',
							exitCode,
							command,
							combinedOutput,
						);
					}
				}
			}
		} catch (error) {
			// Re-throw if it's a critical hook error (exit code 2+)
			if (error instanceof HookFailedError) {
				throw error;
			}
			// Otherwise just warn - don't block tool execution on unexpected errors
			logger.warn('Failed to execute afterToolCall hook:', error);
		}
	}

	// Re-throw execution error if it exists (from try block)
	if (executionError) {
		const err: any = executionError;
		console.log(
			'[DEBUG] Re-throwing executionError:',
			err.message || String(err),
		);
		throw executionError;
	}

	// Apply token limit validation before returning result (truncates if exceeded)
	const {wrapToolResultWithTokenLimit} = await import('./tokenLimiter.js');
	result = await wrapToolResultWithTokenLimit(result, toolName);

	return result;
}

/**
 * Check if an error is a connection/transport error that warrants a retry
 */
function isConnectionError(error: unknown): boolean {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		return (
			msg.includes('stream') ||
			msg.includes('destroyed') ||
			msg.includes('closed') ||
			msg.includes('ended') ||
			msg.includes('econnreset') ||
			msg.includes('econnrefused') ||
			msg.includes('epipe') ||
			msg.includes('not connected') ||
			msg.includes('transport') ||
			(error as any).code === 'ERR_STREAM_DESTROYED'
		);
	}
	return false;
}

/**
 * Execute a tool on an external MCP service
 * Uses persistent connections to avoid reconnecting on every call
 * Automatically retries with a fresh connection on transport errors
 */
async function executeOnExternalMCPService(
	serviceName: string,
	server: MCPServer,
	toolName: string,
	args: any,
): Promise<any> {
	// 🔥 FIX: Always use persistent connection for external MCP services
	// MCP protocol supports multiple calls - no need to reconnect each time
	let retried = false;

	const attemptCall = async (): Promise<any> => {
		const client = await getPersistentClient(serviceName, server);

		logger.debug(
			`Using persistent MCP client for ${serviceName} tool ${toolName}`,
		);

		// 获取 timeout 配置，默认 5 分钟
		const timeout = server.timeout ?? 300000;

		// Execute the tool with the original tool name (not prefixed)
		const result = await client.callTool(
			{
				name: toolName,
				arguments: args,
			},
			undefined,
			{
				timeout,
				resetTimeoutOnProgress: true,
			},
		);
		logger.debug(`result from ${serviceName} tool ${toolName}:`, result);

		return result.content;
	};

	try {
		return await attemptCall();
	} catch (error) {
		// If it's a connection error, remove stale client and retry once
		if (!retried && isConnectionError(error)) {
			retried = true;
			logger.info(
				`Connection error for ${serviceName}, reconnecting and retrying...`,
			);
			const clientInfo = persistentClients.get(serviceName);
			if (clientInfo) {
				try {
					await clientInfo.client.close();
				} catch {
					// Ignore close errors on stale client
				}
				resourceMonitor.trackMCPConnectionClosed(serviceName);
				persistentClients.delete(serviceName);
			}
			return await attemptCall();
		}
		throw error;
	}
}
