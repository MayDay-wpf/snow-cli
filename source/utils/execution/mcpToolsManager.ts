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
	getMCPTools as getSkillTools,
	executeSkillTool,
} from '../../mcp/skills.js';
import {sessionManager} from '../session/sessionManager.js';
import {logger} from '../core/logger.js';
import {resourceMonitor} from '../core/resourceMonitor.js';
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

	// Add built-in filesystem tools (always available)
	const filesystemServiceTools = filesystemTools.map(tool => ({
		name: tool.name.replace('filesystem-', ''),
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));

	servicesInfo.push({
		serviceName: 'filesystem',
		tools: filesystemServiceTools,
		isBuiltIn: true,
		connected: true,
	});

	for (const tool of filesystemTools) {
		allTools.push({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in terminal tools (always available)
	const terminalServiceTools = terminalTools.map(tool => ({
		name: tool.name.replace('terminal-', ''),
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));

	servicesInfo.push({
		serviceName: 'terminal',
		tools: terminalServiceTools,
		isBuiltIn: true,
		connected: true,
	});

	for (const tool of terminalTools) {
		allTools.push({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in TODO tools (always available)
	const todoSvc = getTodoService(); // This will never return null after lazy init
	await todoSvc.initialize();
	const todoTools = todoSvc.getTools();
	const todoServiceTools = todoTools.map(tool => ({
		name: tool.name.replace('todo-', ''),
		description: tool.description || '',
		inputSchema: tool.inputSchema,
	}));

	servicesInfo.push({
		serviceName: 'todo',
		tools: todoServiceTools,
		isBuiltIn: true,
		connected: true,
	});

	for (const tool of todoTools) {
		allTools.push({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description || '',
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in Notebook tools (always available)
	const notebookServiceTools = notebookTools.map(tool => ({
		name: tool.name.replace('notebook-', ''),
		description: tool.description || '',
		inputSchema: tool.inputSchema,
	}));

	servicesInfo.push({
		serviceName: 'notebook',
		tools: notebookServiceTools,
		isBuiltIn: true,
		connected: true,
	});

	for (const tool of notebookTools) {
		allTools.push({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description || '',
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in ACE Code Search tools (always available)
	const aceServiceTools = aceCodeSearchTools.map(tool => ({
		name: tool.name.replace('ace-', ''),
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));

	servicesInfo.push({
		serviceName: 'ace',
		tools: aceServiceTools,
		isBuiltIn: true,
		connected: true,
	});

	for (const tool of aceCodeSearchTools) {
		allTools.push({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in Web Search tools (always available)
	const websearchServiceTools = websearchTools.map(tool => ({
		name: tool.name.replace('websearch-', ''),
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));

	servicesInfo.push({
		serviceName: 'websearch',
		tools: websearchServiceTools,
		isBuiltIn: true,
		connected: true,
	});

	for (const tool of websearchTools) {
		allTools.push({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in IDE Diagnostics tools (always available)
	const ideDiagnosticsServiceTools = ideDiagnosticsTools.map(tool => ({
		name: tool.name.replace('ide-', ''),
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));

	servicesInfo.push({
		serviceName: 'ide',
		tools: ideDiagnosticsServiceTools,
		isBuiltIn: true,
		connected: true,
	});

	for (const tool of ideDiagnosticsTools) {
		allTools.push({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in Ask User Question tools (always available)
	const askUserQuestionServiceTools = askUserQuestionTools.map(tool => ({
		name: tool.function.name.replace('askuser-', ''),
		description: tool.function.description,
		inputSchema: tool.function.parameters,
	}));

	servicesInfo.push({
		serviceName: 'askuser',
		tools: askUserQuestionServiceTools,
		isBuiltIn: true,
		connected: true,
	});

	for (const tool of askUserQuestionTools) {
		allTools.push({
			type: 'function',
			function: {
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
			},
		});
	}

	// Add sub-agent tools (dynamically generated from configuration)
	const subAgentTools = getSubAgentTools();

	if (subAgentTools.length > 0) {
		servicesInfo.push({
			serviceName: 'subagent',
			tools: subAgentTools,
			isBuiltIn: true,
			connected: true,
		});

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

	// Add skill tools (dynamically generated from available skills)
	const projectRoot = process.cwd();
	const skillTools = await getSkillTools(projectRoot);

	if (skillTools.length > 0) {
		servicesInfo.push({
			serviceName: 'skill',
			tools: skillTools,
			isBuiltIn: true,
			connected: true,
		});

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
		serviceName === 'subagent'
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
	return await connectAndGetTools(serviceName, server, 3000); // Short timeout for probing
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
	let client: Client | null = null;
	let transport: any;
	let timeoutId: NodeJS.Timeout | null = null;
	let connectionAborted = false;

	// Create abort mechanism for cleanup
	const abortConnection = () => {
		connectionAborted = true;
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	try {
		client = new Client(
			{
				name: `snow-cli-${serviceName}`,
				version: '1.0.0',
			},
			{
				capabilities: {},
			},
		);

		resourceMonitor.trackMCPConnectionOpened(serviceName);

		// Create transport based on server configuration
		if (server.url) {
			let urlString = server.url;

			if (server.env) {
				const allEnv = {...process.env, ...server.env};
				urlString = urlString.replace(
					/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
					(match, braced, simple) => {
						const varName = braced || simple;
						return allEnv[varName] || match;
					},
				);
			} else {
				urlString = urlString.replace(
					/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
					(match, braced, simple) => {
						const varName = braced || simple;
						return process.env[varName] || match;
					},
				);
			}

			const url = new URL(urlString);

			try {
				// Try StreamableHTTP transport first (recommended)
				logger.debug(
					`[MCP] Attempting StreamableHTTP connection to ${serviceName}...`,
				);

				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
				};

				if (server.env) {
					const allEnv = {...process.env, ...server.env};
					if (allEnv['MCP_API_KEY']) {
						headers['Authorization'] = `Bearer ${allEnv['MCP_API_KEY']}`;
					}
					if (allEnv['MCP_AUTH_HEADER']) {
						headers['Authorization'] = allEnv['MCP_AUTH_HEADER'];
					}
				}

				transport = new StreamableHTTPClientTransport(url, {
					requestInit: {headers},
				});

				// Use timeout with abort mechanism
				await Promise.race([
					client.connect(transport),
					new Promise<never>((_, reject) => {
						timeoutId = setTimeout(() => {
							abortConnection();
							reject(new Error('StreamableHTTP connection timeout'));
						}, timeoutMs);
					}),
				]);

				if (timeoutId) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}

				logger.debug(
					`[MCP] Successfully connected to ${serviceName} using StreamableHTTP`,
				);
			} catch (httpError) {
				// Fallback to SSE transport for backward compatibility
				logger.debug(
					`[MCP] StreamableHTTP failed for ${serviceName}, falling back to SSE (deprecated)...`,
				);

				try {
					await client.close();
				} catch {}

				if (connectionAborted) {
					throw new Error('Connection aborted due to timeout');
				}

				// Recreate client for SSE connection
				client = new Client(
					{
						name: `snow-cli-${serviceName}`,
						version: '1.0.0',
					},
					{
						capabilities: {},
					},
				);

				// SSE transport kept for backward compatibility (deprecated)
				transport = new SSEClientTransport(url);
				await Promise.race([
					client.connect(transport),
					new Promise<never>((_, reject) => {
						timeoutId = setTimeout(() => {
							abortConnection();
							reject(new Error('SSE connection timeout'));
						}, timeoutMs);
					}),
				]);

				if (timeoutId) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}

				logger.debug(
					`[MCP] Successfully connected to ${serviceName} using SSE (deprecated)`,
				);
			}
		} else if (server.command) {
			const processEnv: Record<string, string> = {};

			Object.entries(process.env).forEach(([key, value]) => {
				if (value !== undefined) {
					processEnv[key] = value;
				}
			});

			if (server.env) {
				Object.assign(processEnv, server.env);
			}

			transport = new StdioClientTransport({
				command: server.command,
				args: server.args || [],
				env: processEnv,
				stderr: 'ignore', // 屏蔽第三方MCP服务的stderr输出,避免干扰CLI界面
			});

			await client.connect(transport);
		} else {
			throw new Error('No URL or command specified');
		}

		// Get tools from the service
		const toolsResult = await Promise.race([
			client.listTools(),
			new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => {
					abortConnection();
					reject(new Error('ListTools timeout'));
				}, timeoutMs);
			}),
		]);

		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}

		return (
			toolsResult.tools?.map(tool => ({
				name: tool.name,
				description: tool.description || '',
				inputSchema: tool.inputSchema,
			})) || []
		);
	} finally {
		// Clean up timeout
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		try {
			if (client) {
				await Promise.race([
					client.close(),
					new Promise(resolve => setTimeout(resolve, 1000)), // Max 1s for cleanup
				]);
				resourceMonitor.trackMCPConnectionClosed(serviceName);
			}
		} catch (error) {
			logger.warn(`Failed to close client for ${serviceName}:`, error);
			resourceMonitor.trackMCPConnectionClosed(serviceName); // Track even on error
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
	// Check if we have an existing client
	const existing = persistentClients.get(serviceName);
	if (existing) {
		existing.lastUsed = Date.now();
		return existing.client;
	}

	// Create new persistent client
	const client = new Client(
		{
			name: `snow-cli-${serviceName}`,
			version: '1.0.0',
		},
		{
			capabilities: {},
		},
	);

	resourceMonitor.trackMCPConnectionOpened(serviceName);

	let transport: any;

	if (server.url) {
		let urlString = server.url;
		if (server.env) {
			const allEnv = {...process.env, ...server.env};
			urlString = urlString.replace(
				/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
				(match, braced, simple) => {
					const varName = braced || simple;
					return allEnv[varName] || match;
				},
			);
		}
		const url = new URL(urlString);
		transport = new StreamableHTTPClientTransport(url);
	} else if (server.command) {
		transport = new StdioClientTransport({
			command: server.command,
			args: server.args || [],
			env: server.env
				? ({...process.env, ...server.env} as Record<string, string>)
				: (process.env as Record<string, string>),
			stderr: 'pipe', // Persistent services need stderr for process communication
		});
	}

	await client.connect(transport);

	// Store the persistent client
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

	// Execute beforeToolCall hook
	try {
		const {unifiedHooksExecutor} = await import('./unifiedHooksExecutor.js');
		const hookResult = await unifiedHooksExecutor.executeHooks(
			'beforeToolCall',
			{
				toolName,
				args,
			},
		);

		// Handle hook exit codes: 0=continue, 1=continue, 2+=throw
		if (hookResult && !hookResult.success) {
			// Find failed command hook
			const commandError = hookResult.results.find(
				(r: any) => r.type === 'command' && !r.success,
			);

			if (commandError && commandError.type === 'command') {
				const {exitCode, command, output, error} = commandError;

				// Exit code 2+: Throw error to stop AI conversation
				if (exitCode >= 2 || exitCode < 0) {
					const combinedOutput =
						[output, error].filter(Boolean).join('\n\n') || '(no output)';
					const hookError = new Error(
						`beforeToolCall hook failed with exit code ${exitCode}\n` +
							`Command: ${command}\n` +
							`Output:\n${combinedOutput}`,
					) as HookError;
					hookError.isHookFailure = true;
					throw hookError;
				} else if (exitCode === 1) {
					// Exit code 1: Warning, log and continue execution
					console.warn(
						`[WARN] beforeToolCall hook warning (exitCode: ${exitCode}):
` +
							`output: ${output || '(empty)'}
` +
							`error: ${error || '(empty)'}`,
					);
				}
				// Exit code 0: Success, continue silently
			}
		}
	} catch (error) {
		// Re-throw hook errors to stop AI conversation
		if ((error as HookError)?.isHookFailure) {
			throw error;
		}
		// Otherwise log and continue - don't block on unexpected errors
		console.warn('Failed to execute beforeToolCall hook:', error);
	}

	let result: any;
	let executionError: Error | null = null;

	try {
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
		} else if (toolName.startsWith('skill-')) {
			serviceName = 'skill';
			actualToolName = toolName.substring('skill-'.length);
		} else if (toolName.startsWith('subagent-')) {
			serviceName = 'subagent';
			actualToolName = toolName.substring('subagent-'.length);
		} else {
			// Check configured MCP services
			try {
				const mcpConfig = getMCPConfig();
				for (const configuredServiceName of Object.keys(mcpConfig.mcpServers)) {
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
					// Set execution state to show UI
					setTerminalExecutionState({
						isExecuting: true,
						command: args.command,
						timeout: args.timeout || 30000,
					});

					try {
						result = await terminalService.executeCommand(
							args.command,
							args.timeout,
						);
					} finally {
						// Clear execution state
						setTerminalExecutionState({
							isExecuting: false,
							command: null,
							timeout: null,
						});
					}
					break;
				default:
					throw new Error(`Unknown terminal tool: ${actualToolName}`);
			}
		} else if (serviceName === 'ace') {
			// Handle built-in ACE Code Search tools (no connection needed)
			const {aceCodeSearchService} = await import('../../mcp/aceCodeSearch.js');

			switch (actualToolName) {
				case 'search_symbols':
					result = await aceCodeSearchService.searchSymbols(
						args.query,
						args.symbolType,
						args.language,
						args.maxResults,
					);
					break;
				case 'find_definition':
					result = await aceCodeSearchService.findDefinition(
						args.symbolName,
						args.contextFile,
					);
					break;
				case 'find_references':
					result = await aceCodeSearchService.findReferences(
						args.symbolName,
						args.maxResults,
					);
					break;
				case 'semantic_search':
					result = await aceCodeSearchService.semanticSearch(
						args.query,
						args.searchType,
						args.language,
						args.maxResults,
					);
					break;
				case 'file_outline':
					result = await aceCodeSearchService.getFileOutline(args.filePath, {
						maxResults: args.maxResults,
						includeContext: args.includeContext,
						symbolTypes: args.symbolTypes,
					});
					break;
				case 'text_search':
					result = await aceCodeSearchService.textSearch(
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
			// Handle Ask User Question tool - throw error to trigger user interaction
			switch (actualToolName) {
				case 'ask_question':
					// Throw UserInteractionNeededError to trigger UI component
					const {UserInteractionNeededError} = await import(
						'../ui/userInteractionError.js'
					);
					throw new UserInteractionNeededError(
						args.question,
						args.options,
						'', // toolCallId will be set by executeToolCall
					);
				default:
					throw new Error(`Unknown askuser tool: ${actualToolName}`);
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
						// Exit code 1: Warning - log and append to tool result
						console.warn(
							`[WARN] afterToolCall hook warning (exitCode: ${exitCode}):
` +
								`output: ${output || '(empty)'}
` +
								`error: ${error || '(empty)'}`,
						);

						const combinedOutput =
							[output, error].filter(Boolean).join('\n\n') || '(no output)';
						const warningMessage = `

[afterToolCall Hook Warning]
Command: ${command}
Output:
${combinedOutput}`;

						// Append warning to result
						if (typeof result === 'string') {
							result = result + warningMessage;
						} else if (result && typeof result === 'object') {
							// For object results, try to append to content field or convert to string
							if ('content' in result && typeof result.content === 'string') {
								result.content = result.content + warningMessage;
							} else {
								result = JSON.stringify(result, null, 2) + warningMessage;
							}
						}
					} else if (exitCode >= 2 || exitCode < 0) {
						// Exit code 2+: Critical error - throw exception
						const combinedOutput =
							[output, error].filter(Boolean).join('\n\n') || '(no output)';
						throw new Error(
							`afterToolCall hook failed with exit code ${exitCode}
` +
								`Command: ${command}\n` +
								`Output:\n${combinedOutput}`,
						);
					}
					// Exit code 0: Success, continue silently
				}
			}
		} catch (error) {
			// Re-throw if it's a critical hook error (exit code 2+)
			if (
				error instanceof Error &&
				error.message.includes('afterToolCall hook failed')
			) {
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

	return result;
}

/**
 * Execute a tool on an external MCP service
 * Uses persistent connections to avoid reconnecting on every call
 */
async function executeOnExternalMCPService(
	serviceName: string,
	server: MCPServer,
	toolName: string,
	args: any,
): Promise<any> {
	// 🔥 FIX: Always use persistent connection for external MCP services
	// MCP protocol supports multiple calls - no need to reconnect each time
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
}
