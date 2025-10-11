import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {getMCPConfig, type MCPServer} from './apiConfig.js';
import {mcpTools as filesystemTools} from '../mcp/filesystem.js';
import {mcpTools as terminalTools} from '../mcp/bash.js';
import {TodoService} from '../mcp/todo.js';
import {sessionManager} from './sessionManager.js';
import {logger} from './logger.js';
import os from 'os';
import path from 'path';

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

// Initialize TODO service with sessionManager accessor
const todoService = new TodoService(path.join(os.homedir(), '.snow'), () => {
	const session = sessionManager.getCurrentSession();
	return session ? session.id : null;
});

/**
 * Get the TODO service instance
 */
export function getTodoService(): TodoService {
	return todoService;
}

/**
 * Generate a hash of the current MCP configuration
 */
function generateConfigHash(): string {
	try {
		const mcpConfig = getMCPConfig();
		return JSON.stringify(mcpConfig.mcpServers);
	} catch {
		return '';
	}
}

/**
 * Check if the cache is valid and not expired
 */
function isCacheValid(): boolean {
	if (!toolsCache) return false;

	const now = Date.now();
	const isExpired = now - toolsCache.lastUpdate > CACHE_DURATION;
	const configChanged = toolsCache.configHash !== generateConfigHash();

	return !isExpired && !configChanged;
}

/**
 * Get cached tools or build cache if needed
 */
async function getCachedTools(): Promise<MCPTool[]> {
	if (isCacheValid()) {
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
		name: tool.name.replace('filesystem_', ''),
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
				name: `filesystem-${tool.name.replace('filesystem_', '')}`,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in terminal tools (always available)
	const terminalServiceTools = terminalTools.map(tool => ({
		name: tool.name.replace('terminal_', ''),
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
				name: `terminal-${tool.name.replace('terminal_', '')}`,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		});
	}

	// Add built-in TODO tools (always available)
	await todoService.initialize();
	const todoTools = todoService.getTools();
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

	// Add user-configured MCP server tools (probe for availability but don't maintain connections)
	try {
		const mcpConfig = getMCPConfig();
		for (const [serviceName, server] of Object.entries(mcpConfig.mcpServers)) {
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
		configHash: generateConfigHash(),
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
	if (!isCacheValid()) {
		await refreshToolsCache();
	}
	return toolsCache!.servicesInfo;
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
				// Try HTTP first
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

				await Promise.race([
					client.connect(transport),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error('HTTP connection timeout')),
							timeoutMs,
						),
					),
				]);
			} catch (httpError) {
				// Fallback to SSE
				try {
					await client.close();
				} catch {}

				client = new Client(
					{
						name: `snow-cli-${serviceName}`,
						version: '1.0.0',
					},
					{
						capabilities: {},
					},
				);

				transport = new SSEClientTransport(url);
				await Promise.race([
					client.connect(transport),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error('SSE connection timeout')),
							timeoutMs,
						),
					),
				]);
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
			});

			await client.connect(transport);
		} else {
			throw new Error('No URL or command specified');
		}

		// Get tools from the service
		const toolsResult = await Promise.race([
			client.listTools(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('ListTools timeout')), timeoutMs),
			),
		]);

		return (
			toolsResult.tools?.map(tool => ({
				name: tool.name,
				description: tool.description || '',
				inputSchema: tool.inputSchema,
			})) || []
		);
	} finally {
		try {
			if (client) {
				await client.close();
			}
		} catch (error) {
			logger.warn(`Failed to close client for ${serviceName}:`, error);
		}
	}
}

/**
 * Execute an MCP tool by parsing the prefixed tool name
 * Only connects to the service when actually needed
 */
export async function executeMCPTool(
	toolName: string,
	args: any,
): Promise<any> {
	// Find the service name by checking against known services
	let serviceName: string | null = null;
	let actualToolName: string | null = null;

	// Check built-in services first
	if (toolName.startsWith('todo-')) {
		serviceName = 'todo';
		actualToolName = toolName.substring('todo-'.length);
	} else if (toolName.startsWith('filesystem-')) {
		serviceName = 'filesystem';
		actualToolName = toolName.substring('filesystem-'.length);
	} else if (toolName.startsWith('terminal-')) {
		serviceName = 'terminal';
		actualToolName = toolName.substring('terminal-'.length);
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
		return await todoService.executeTool(toolName, args);
	} else if (serviceName === 'filesystem') {
		// Handle built-in filesystem tools (no connection needed)
		const {filesystemService} = await import('../mcp/filesystem.js');

		switch (actualToolName) {
			case 'read':
				return await filesystemService.getFileContent(
					args.filePath,
					args.startLine,
					args.endLine,
				);
			case 'create':
				return await filesystemService.createFile(
					args.filePath,
					args.content,
					args.createDirectories,
				);
			case 'delete':
				// Support both filePath (legacy) and filePaths (new) parameters
				const pathsToDelete = args.filePaths || args.filePath;
				if (!pathsToDelete) {
					throw new Error('Missing required parameter: filePath or filePaths');
				}
				return await filesystemService.deleteFile(pathsToDelete);
			case 'list':
				return await filesystemService.listFiles(args.dirPath);
			case 'exists':
				return await filesystemService.exists(args.filePath);
			case 'info':
				return await filesystemService.getFileInfo(args.filePath);
			case 'edit':
				return await filesystemService.editFile(
					args.filePath,
					args.startLine,
					args.endLine,
					args.newContent,
					args.contextLines,
				);
			case 'search': {
				// 兼容性处理:如果 searchMode 不存在或无效,默认使用 'text'
				const validSearchModes = ['text', 'regex'] as const;
				let searchMode: 'text' | 'regex' = 'text';

				if (args.searchMode && validSearchModes.includes(args.searchMode)) {
					searchMode = args.searchMode;
				}

				return await filesystemService.searchCode(
					args.query,
					args.dirPath,
					args.fileExtensions,
					args.caseSensitive,
					args.maxResults,
					searchMode,
				);
			}

			default:
				throw new Error(`Unknown filesystem tool: ${actualToolName}`);
		}
	} else if (serviceName === 'terminal') {
		// Handle built-in terminal tools (no connection needed)
		const {terminalService} = await import('../mcp/bash.js');

		switch (actualToolName) {
			case 'execute':
				return await terminalService.executeCommand(args.command, args.timeout);
			default:
				throw new Error(`Unknown terminal tool: ${actualToolName}`);
		}
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
		return await executeOnExternalMCPService(
			serviceName,
			server,
			actualToolName,
			args,
		);
	}
}

/**
 * Execute a tool on an external MCP service - connects only when needed
 */
async function executeOnExternalMCPService(
	serviceName: string,
	server: MCPServer,
	toolName: string,
	args: any,
): Promise<any> {
	let client: Client | null = null;
	logger.debug(
		`Connecting to MCP service ${serviceName} to execute tool ${toolName}...`,
	);

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

		// Setup transport (similar to getServiceTools)
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
			});
		}

		await client.connect(transport);

		logger.debug(
			`ToolName ${toolName}, args:`,
			args ? JSON.stringify(args) : 'none',
		);
		// Execute the tool with the original tool name (not prefixed)
		const result = await client.callTool({
			name: toolName,
			arguments: args,
		});
		logger.debug(`result from ${serviceName} tool ${toolName}:`, result);

		return result.content;
	} finally {
		try {
			if (client) {
				await client.close();
			}
		} catch (error) {
			logger.warn(`Failed to close client for ${serviceName}:`, error);
		}
	}
}
