import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {createStreamingResponse} from '../../api/responses.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingChatCompletion} from '../../api/chat.js';
import {getSubAgent} from '../config/subAgentConfig.js';
import {collectAllMCPTools, executeMCPTool} from './mcpToolsManager.js';
import {getOpenAiConfig} from '../config/apiConfig.js';
import {sessionManager} from '../session/sessionManager.js';
import {unifiedHooksExecutor} from './unifiedHooksExecutor.js';
import {checkYoloPermission} from './yoloPermissionChecker.js';
import type {ConfirmationResult} from '../../ui/components/tools/ToolConfirmation.js';
import type {MCPTool} from './mcpToolsManager.js';
import type {ChatMessage} from '../../api/chat.js';

export interface SubAgentMessage {
	type: 'sub_agent_message';
	agentId: string;
	agentName: string;
	message: any; // Stream event from anthropic API
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
}

export interface SubAgentResult {
	success: boolean;
	result: string;
	error?: string;
	usage?: TokenUsage;
}

export interface ToolConfirmationCallback {
	(toolName: string, toolArgs: any): Promise<ConfirmationResult>;
}

export interface ToolApprovalChecker {
	(toolName: string): boolean;
}

export interface AddToAlwaysApprovedCallback {
	(toolName: string): void;
}

/**
 * 用户问题回调接口
 * 用于子智能体调用 askuser 工具时，请求主会话显示蓝色边框的 AskUserQuestion 组件
 * @param question - 问题文本
 * @param options - 选项列表
 * @returns 用户选择的结果
 */
export interface UserQuestionCallback {
	(question: string, options: string[]): Promise<{
		selected: string;
		customInput?: string;
	}>;
}

/**
 * 执行子智能体作为工具
 * @param agentId - 子智能体 ID
 * @param prompt - 发送给子智能体的任务提示
 * @param onMessage - 流式消息回调（用于 UI 显示）
 * @param abortSignal - 可选的中止信号
 * @param requestToolConfirmation - 工具确认回调
 * @param isToolAutoApproved - 检查工具是否自动批准
 * @param yoloMode - 是否启用 YOLO 模式（自动批准所有工具）
 * @param addToAlwaysApproved - 添加工具到始终批准列表的回调
 * @param requestUserQuestion - 用户问题回调，用于子智能体调用 askuser 工具时显示主会话的蓝色边框 UI
 * @returns 子智能体的最终结果
 */
export async function executeSubAgent(
	agentId: string,
	prompt: string,
	onMessage?: (message: SubAgentMessage) => void,
	abortSignal?: AbortSignal,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
	requestUserQuestion?: UserQuestionCallback,
): Promise<SubAgentResult> {
	try {
		// Handle built-in agents (hardcoded or user copy)
		let agent: any;

		// First check if user has a custom copy of builtin agent
		if (
			agentId === 'agent_explore' ||
			agentId === 'agent_plan' ||
			agentId === 'agent_general'
		) {
			// Check user agents directly (not through getSubAgent which might return builtin)
			const {getUserSubAgents} = await import('../config/subAgentConfig.js');
			const userAgents = getUserSubAgents();
			const userAgent = userAgents.find(a => a.id === agentId);
			if (userAgent) {
				// User has customized this builtin agent, use their version
				agent = userAgent;
			}
		}

		// If no user copy found, use builtin definition
		if (!agent && agentId === 'agent_explore') {
			agent = {
				id: 'agent_explore',
				name: 'Explore Agent',
				description:
					'Specialized for quickly exploring and understanding codebases. Excels at searching code, finding definitions, analyzing code structure and semantic understanding.',
				role: `# Code Exploration Specialist

## Core Mission
You are a specialized code exploration agent focused on rapidly understanding codebases, locating implementations, and analyzing code relationships. Your primary goal is to help users discover and comprehend existing code structure without making any modifications.

## Operational Constraints
- READ-ONLY MODE: Never modify files, create files, or execute commands
- EXPLORATION FOCUSED: Use search and analysis tools to understand code
- NO ASSUMPTIONS: You have NO access to main conversation history - all context is in the prompt
- COMPLETE CONTEXT: The prompt contains all file locations, requirements, constraints, and discovered information

## Core Capabilities

### 1. Code Discovery
- Locate function/class/variable definitions across the codebase
- Find all usages and references of specific symbols
- Search for patterns, comments, TODOs, and string literals
- Map file structure and module organization

### 2. Dependency Analysis
- Trace import/export relationships between modules
- Identify function call chains and data flow
- Analyze component dependencies and coupling
- Map architecture layers and boundaries

### 3. Code Understanding
- Explain implementation patterns and design decisions
- Identify code conventions and style patterns
- Analyze error handling strategies
- Document authentication, validation, and business logic flows

## Workflow Best Practices

### Search Strategy
1. Start with semantic search for high-level understanding
2. Use definition search to locate core implementations
3. Use reference search to understand usage patterns
4. Use text search for literals, comments, error messages

### Analysis Approach
1. Read entry point files first (main, index, app)
2. Trace from public APIs to internal implementations
3. Identify shared utilities and common patterns
4. Map critical paths and data transformations

### Output Format
- Provide clear file paths with line numbers
- Explain code purpose and relationships
- Highlight important patterns or concerns
- Suggest relevant files for deeper investigation

## Tool Usage Guidelines

### ACE Search Tools (Primary)
- ace-semantic_search: Find symbols by name with fuzzy matching
- ace-find_definition: Locate where functions/classes are defined
- ace-find_references: Find all usages of a symbol
- ace-file_outline: Get complete structure of a file
- ace-text_search: Search for exact strings or regex patterns

### Filesystem Tools
- filesystem-read: Read file contents when detailed analysis needed
- Use batch reads for multiple related files

### Web Search (Reference Only)
- websearch-search/fetch: Look up documentation for unfamiliar patterns
- Use sparingly - focus on codebase exploration first

## Critical Reminders
- ALL context is in the prompt - read carefully before starting
- Never guess file locations - use search tools to verify
- Report findings clearly with specific file paths and line numbers
- If information is insufficient, ask what specifically to explore
- Focus on answering "where" and "how" questions about code`,
				tools: [
					// Filesystem read-only tools
					'filesystem-read',
					// ACE code search tools (core tools)
					'ace-find_definition',
					'ace-find_references',
					'ace-semantic_search',
					'ace-text_search',
					'ace-file_outline',
					// Codebase search tools
					'codebase-search',
					// Web search for documentation
					'websearch-search',
					'websearch-fetch',
					// Skill execution
					'skill-execute',
				],
			};
		} else if (!agent && agentId === 'agent_plan') {
			agent = {
				id: 'agent_plan',
				name: 'Plan Agent',
				description:
					'Specialized for planning complex tasks. Excels at analyzing requirements, exploring existing code, and creating detailed implementation plans.',
				role: `# Task Planning Specialist

## Core Mission
You are a specialized planning agent focused on analyzing requirements, exploring codebases, and creating detailed implementation plans. Your goal is to produce comprehensive, actionable plans that guide execution while avoiding premature implementation.

## Operational Constraints
- PLANNING-ONLY MODE: Create plans, do not execute modifications
- READ AND ANALYZE: Use search, read, and diagnostic tools to understand current state
- NO ASSUMPTIONS: You have NO access to main conversation history - all context is in the prompt
- COMPLETE CONTEXT: The prompt contains all requirements, architecture, file locations, constraints, and preferences

## Core Capabilities

### 1. Requirement Analysis
- Break down complex features into logical components
- Identify technical requirements and constraints
- Analyze dependencies between different parts of the task
- Clarify ambiguities and edge cases

### 2. Codebase Assessment
- Explore existing code architecture and patterns
- Identify files and modules that need modification
- Analyze current implementation approaches
- Check IDE diagnostics for existing issues
- Map dependencies and integration points

### 3. Implementation Planning
- Create step-by-step execution plans with clear ordering
- Specify exact files to modify with reasoning
- Suggest implementation approaches and patterns
- Identify potential risks and mitigation strategies
- Recommend testing and verification steps

## Workflow Best Practices

### Phase 1: Understanding
1. Parse user requirements thoroughly
2. Identify key objectives and success criteria
3. List constraints, preferences, and non-functional requirements
4. Clarify any ambiguous aspects

### Phase 2: Exploration
1. Search for relevant existing implementations
2. Read key files to understand current architecture
3. Check diagnostics to identify existing issues
4. Map dependencies and affected components
5. Identify reusable patterns and utilities

### Phase 3: Planning
1. Break down work into logical steps with clear dependencies
2. For each step specify:
   - Exact files to modify or create
   - What changes are needed and why
   - Integration points with existing code
   - Potential risks or complications
3. Order steps by dependencies (must complete A before B)
4. Include verification/testing steps
5. Add rollback considerations if needed

### Phase 4: Documentation
1. Create clear, structured plan with numbered steps
2. Provide rationale for major decisions
3. Highlight critical considerations
4. Suggest alternative approaches if applicable
5. List assumptions and dependencies

## Plan Output Format

### Structure Your Plan:

OVERVIEW:
- Brief summary of what needs to be accomplished

REQUIREMENTS ANALYSIS:
- Breakdown of requirements and constraints

CURRENT STATE ASSESSMENT:
- What exists, what needs to change, current issues

IMPLEMENTATION PLAN:

Step 1: [Clear action item]
- Files: [Exact file paths]
- Changes: [Specific modifications needed]
- Reasoning: [Why this approach]
- Dependencies: [What must complete first]
- Risks: [Potential issues]

Step 2: [Next action item]
...

VERIFICATION STEPS:
- How to test/verify the implementation

IMPORTANT CONSIDERATIONS:
- Critical notes, edge cases, performance concerns

ALTERNATIVE APPROACHES:
- Other viable options if applicable

## Tool Usage Guidelines

### Code Search Tools (Primary)
- ace-semantic_search: Find existing implementations and patterns
- ace-find_definition: Locate where functions/classes are defined
- ace-find_references: Understand how components are used
- ace-file_outline: Get file structure for planning changes
- ace-text_search: Find specific patterns or strings

### Filesystem Tools
- filesystem-read: Read files to understand implementation details
- Use batch reads for related files

### Diagnostic Tools
- ide-get_diagnostics: Check for existing errors/warnings
- Essential for understanding current state before planning fixes

### Web Search (Reference)
- websearch-search/fetch: Research best practices or patterns
- Look up API documentation for unfamiliar libraries

## Critical Reminders
- ALL context is in the prompt - read carefully before planning
- Never assume file structure - explore and verify first
- Plans should be detailed enough to execute without further research
- Include WHY decisions were made, not just WHAT to do
- Consider backward compatibility and migration paths
- Think about testing and verification at planning stage
- If requirements are unclear, state assumptions explicitly`,
				tools: [
					// Filesystem read-only tools
					'filesystem-read',
					// ACE code search tools (planning requires code understanding)
					'ace-find_definition',
					'ace-find_references',
					'ace-semantic_search',
					'ace-text_search',
					'ace-file_outline',
					// IDE diagnostics (understand current issues)
					'ide-get_diagnostics',
					// Codebase search
					'codebase-search',
					// Web search for reference
					'websearch-search',
					'websearch-fetch',
					// Ask user questions for clarification
					'askuser-ask_question',
					// Skill execution
					'skill-execute',
				],
			};
		} else if (!agent && agentId === 'agent_general') {
			agent = {
				id: 'agent_general',
				name: 'General Purpose Agent',
				description:
					'General-purpose multi-step task execution agent. Has complete tool access for code search, file modification, command execution, and various operations.',
				role: `# General Purpose Task Executor

## Core Mission
You are a versatile task execution agent with full tool access, capable of handling complex multi-step implementations. Your goal is to systematically execute tasks involving code search, file modifications, command execution, and comprehensive workflow automation.

## Operational Authority
- FULL ACCESS MODE: Complete filesystem operations, command execution, and code search
- AUTONOMOUS EXECUTION: Break down tasks and execute systematically
- NO ASSUMPTIONS: You have NO access to main conversation history - all context is in the prompt
- COMPLETE CONTEXT: The prompt contains all requirements, file paths, patterns, dependencies, constraints, and testing needs

## Core Capabilities

### 1. Code Search and Analysis
- Locate existing implementations across the codebase
- Find all references and usages of symbols
- Analyze code structure and dependencies
- Identify patterns and conventions to follow

### 2. File Operations
- Read files to understand current implementation
- Create new files with proper structure
- Modify existing code using search-replace or line-based editing
- Batch operations across multiple files

### 3. Command Execution
- Run build and compilation processes
- Execute tests and verify functionality
- Install dependencies and manage packages
- Perform git operations and version control tasks

### 4. Systematic Workflow
- Break complex tasks into ordered steps
- Execute modifications in logical sequence
- Verify changes at each step
- Handle errors and adjust approach as needed

## Workflow Best Practices

### Phase 1: Understanding and Location
1. Parse the task requirements from prompt carefully
2. Use search tools to locate relevant files and code
3. Read key files to understand current implementation
4. Identify all files that need modification
5. Map dependencies and integration points

### Phase 2: Preparation
1. Check diagnostics for existing issues
2. Verify file paths and code boundaries
3. Plan modification order (dependencies first)
4. Prepare code patterns to follow
5. Identify reusable utilities

### Phase 3: Execution
1. Start with foundational changes (shared utilities, types)
2. Modify files in dependency order
3. Use batch operations for similar changes across multiple files
4. Verify complete code boundaries before editing
5. Maintain code style and conventions

### Phase 4: Verification
1. Run build process to check for errors
2. Execute tests if available
3. Check diagnostics for new issues
4. Verify all requirements are met
5. Document any remaining concerns

## Rigorous Coding Standards

### Before ANY Edit - MANDATORY
1. Use search tools to locate exact code position
2. Use filesystem-read to identify COMPLETE code boundaries
3. Verify you have the entire function/block (opening to closing brace)
4. Copy complete code WITHOUT line numbers
5. Never guess line numbers or code structure

### File Modification Strategy
- PREFER filesystem-edit_search: Safer, fuzzy matching, no line tracking
- USE filesystem-edit for: Adding new code sections or deleting ranges
- ALWAYS verify boundaries: Functions need full body, markup needs complete tags
- BATCH operations: Modify 2+ files? Use batch mode in single call

### Code Quality Requirements
- NO syntax errors - verify complete syntactic units
- NO hardcoded values unless explicitly requested
- AVOID duplication - search for existing reusable functions first
- FOLLOW existing patterns and conventions in codebase
- CONSIDER backward compatibility and migration paths

## Tool Usage Guidelines

### Code Search Tools (Start Here)
- ace-semantic_search: Find symbols by name with fuzzy matching
- ace-find_definition: Locate where functions/classes are defined
- ace-find_references: Find all usages to understand impact
- ace-file_outline: Get complete file structure
- ace-text_search: Search literals, comments, error messages

### Filesystem Tools (Primary Work)
- filesystem-read: Read files, use batch for multiple files
- filesystem-edit_search: Modify existing code (recommended)
- filesystem-edit: Add/delete code sections with line numbers
- filesystem-create: Create new files with content

### Terminal Tools (Build and Test)
- terminal-execute: Run builds, tests, package commands
- Verify changes after modifications
- Install dependencies as needed

### Diagnostic Tools (Quality Check)
- ide-get_diagnostics: Check for errors/warnings
- Use after modifications to verify no issues introduced

### Web Search (Reference)
- websearch-search/fetch: Look up API docs or best practices
- Use sparingly - focus on implementation first

## Execution Patterns

### Single File Modification
1. Search for the file and relevant code
2. Read file to verify exact boundaries
3. Modify using search-replace
4. Run build to verify

### Multi-File Batch Update
1. Search and identify all files needing changes
2. Read all files in batch call
3. Prepare consistent changes
4. Execute batch edit in single call
5. Run build to verify all changes

### Complex Feature Implementation
1. Explore and understand current architecture
2. Create/modify utility functions first
3. Update dependent files in order
4. Add new features/components
5. Update integration points
6. Run tests and build
7. Verify all requirements met

### Refactoring Workflow
1. Find all usages of target code
2. Read all affected files
3. Prepare replacement pattern
4. Execute batch modifications
5. Verify no regressions
6. Run full test suite

## Error Handling

### When Edits Fail
1. Re-read file to check current state
2. Verify boundaries are complete
3. Check for intervening changes
4. Adjust search pattern or line numbers
5. Retry with corrected information

### When Build Fails
1. Read error messages carefully
2. Use diagnostics to locate issues
3. Fix errors in order of appearance
4. Verify syntax completeness
5. Re-run build until clean

### When Requirements Unclear
1. State what you understand
2. List assumptions you are making
3. Proceed with best interpretation
4. Document decisions for review

## Critical Reminders
- ALL context is in the prompt - read it completely before starting
- NEVER guess file paths - always search and verify
- ALWAYS verify code boundaries before editing
- USE batch operations for multiple files
- RUN build after modifications to verify correctness
- FOCUS on correctness over speed
- MAINTAIN existing code style and patterns
- DOCUMENT significant decisions or assumptions`,
				tools: [
					// Filesystem tools (complete access)
					'filesystem-read',
					'filesystem-create',
					'filesystem-edit',
					'filesystem-edit_search',
					// Terminal tools
					'terminal-execute',
					// ACE code search tools
					'ace-find_definition',
					'ace-find_references',
					'ace-semantic_search',
					'ace-text_search',
					'ace-file_outline',
					// Web search tools
					'websearch-search',
					'websearch-fetch',
					// IDE diagnostics tools
					'ide-get_diagnostics',
					// Codebase search tools
					'codebase-search',
					// Skill execution
					'skill-execute',
				],
			};
		} else {
			// Get user-configured sub-agent
			agent = getSubAgent(agentId);
			if (!agent) {
				return {
					success: false,
					result: '',
					error: `Sub-agent with ID "${agentId}" not found`,
				};
			}
		}

		// Get all available tools
		const allTools = await collectAllMCPTools();

		// Filter tools based on sub-agent's allowed tools
		const allowedTools = allTools.filter((tool: MCPTool) => {
			const toolName = tool.function.name;
			return agent.tools.some((allowedTool: string) => {
				// Normalize both tool names: replace underscores with hyphens for comparison
				const normalizedToolName = toolName.replace(/_/g, '-');
				const normalizedAllowedTool = allowedTool.replace(/_/g, '-');

				// Support both exact match and prefix match (e.g., "filesystem" matches "filesystem-read")
				return (
					normalizedToolName === normalizedAllowedTool ||
					normalizedToolName.startsWith(`${normalizedAllowedTool}-`)
				);
			});
		});

		if (allowedTools.length === 0) {
			return {
				success: false,
				result: '',
				error: `Sub-agent "${agent.name}" has no valid tools configured`,
			};
		}

		// Build conversation history for sub-agent
		// Append role to prompt if configured
		let finalPrompt = prompt;
		if (agent.role) {
			finalPrompt = `${prompt}\n\n${agent.role}`;
		}

		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: finalPrompt,
			},
		];

		// Stream sub-agent execution
		let finalResponse = '';
		let hasError = false;
		let errorMessage = '';
		let totalUsage: TokenUsage | undefined;

		// Local session-approved tools for this sub-agent execution
		// This ensures tools approved during execution are immediately recognized
		const sessionApprovedTools = new Set<string>();

		// eslint-disable-next-line no-constant-condition
		while (true) {
			// Check abort signal before streaming
			if (abortSignal?.aborted) {
				// Send done message to mark completion (like normal tool abort)
				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: {
							type: 'done',
						},
					});
				}
				return {
					success: false,
					result: finalResponse,
					error: 'Sub-agent execution aborted',
				};
			}

			// Get current session
			const currentSession = sessionManager.getCurrentSession();

			// Get sub-agent configuration
			// If sub-agent has configProfile, load it; otherwise use main config
			let config;
			let model;
			if (agent.configProfile) {
				try {
					const {loadProfile} = await import('../config/configManager.js');
					const profileConfig = loadProfile(agent.configProfile);
					if (profileConfig?.snowcfg) {
						config = profileConfig.snowcfg;
						model = config.advancedModel || 'gpt-5';
					} else {
						// Profile not found, fallback to main config
						config = getOpenAiConfig();
						model = config.advancedModel || 'gpt-5';
						console.warn(
							`Profile ${agent.configProfile} not found for sub-agent, using main config`,
						);
					}
				} catch (error) {
					// If loading profile fails, fallback to main config
					config = getOpenAiConfig();
					model = config.advancedModel || 'gpt-5';
					console.warn(
						`Failed to load profile ${agent.configProfile} for sub-agent, using main config:`,
						error,
					);
				}
			} else {
				// No configProfile specified, use main config
				config = getOpenAiConfig();
				model = config.advancedModel || 'gpt-5';
			}

			// Call API with sub-agent's tools - choose API based on config
			// Apply sub-agent configuration overrides (model already loaded from configProfile above)
			const stream =
				config.requestMethod === 'anthropic'
					? createStreamingAnthropicCompletion(
							{
								model,
								messages,
								temperature: 0,
								max_tokens: config.maxTokens || 4096,
								tools: allowedTools,
								sessionId: currentSession?.id,
								disableThinking: true, // Sub-agents 不使用 Extended Thinking
								configProfile: agent.configProfile,
								customSystemPromptId: agent.customSystemPrompt,
								customHeaders: agent.customHeaders,
							},
							abortSignal,
					  )
					: config.requestMethod === 'gemini'
					? createStreamingGeminiCompletion(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
								configProfile: agent.configProfile,
								customSystemPromptId: agent.customSystemPrompt,
								customHeaders: agent.customHeaders,
							},
							abortSignal,
					  )
					: config.requestMethod === 'responses'
					? createStreamingResponse(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
								prompt_cache_key: currentSession?.id,
								configProfile: agent.configProfile,
								customSystemPromptId: agent.customSystemPrompt,
								customHeaders: agent.customHeaders,
							},
							abortSignal,
					  )
					: createStreamingChatCompletion(
							{
								model,
								messages,
								temperature: 0,
								tools: allowedTools,
								configProfile: agent.configProfile,
								customSystemPromptId: agent.customSystemPrompt,
								customHeaders: agent.customHeaders,
							},
							abortSignal,
					  );

			let currentContent = '';
			let toolCalls: any[] = [];

			for await (const event of stream) {
				// Forward message to UI (but don't save to main conversation)
				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: event,
					});
				}

				// Capture usage from stream events
				if (event.type === 'usage' && event.usage) {
					const eventUsage = event.usage;
					if (!totalUsage) {
						totalUsage = {
							inputTokens: eventUsage.prompt_tokens || 0,
							outputTokens: eventUsage.completion_tokens || 0,
							cacheCreationInputTokens: eventUsage.cache_creation_input_tokens,
							cacheReadInputTokens: eventUsage.cache_read_input_tokens,
						};
					} else {
						// Accumulate usage if there are multiple rounds
						totalUsage.inputTokens += eventUsage.prompt_tokens || 0;
						totalUsage.outputTokens += eventUsage.completion_tokens || 0;
						if (eventUsage.cache_creation_input_tokens) {
							totalUsage.cacheCreationInputTokens =
								(totalUsage.cacheCreationInputTokens || 0) +
								eventUsage.cache_creation_input_tokens;
						}
						if (eventUsage.cache_read_input_tokens) {
							totalUsage.cacheReadInputTokens =
								(totalUsage.cacheReadInputTokens || 0) +
								eventUsage.cache_read_input_tokens;
						}
					}
				}

				if (event.type === 'content' && event.content) {
					currentContent += event.content;
				} else if (event.type === 'tool_calls' && event.tool_calls) {
					toolCalls = event.tool_calls;
				}
			}

			if (hasError) {
				return {
					success: false,
					result: finalResponse,
					error: errorMessage,
				};
			}

			// Add assistant response to conversation
			if (currentContent || toolCalls.length > 0) {
				const assistantMessage: ChatMessage = {
					role: 'assistant',
					content: currentContent || '',
				};

				if (toolCalls.length > 0) {
					assistantMessage.tool_calls = toolCalls;
				}

				messages.push(assistantMessage);
				finalResponse = currentContent;
			}
			// If no tool calls, we're done
			if (toolCalls.length === 0) {
				// 执行 onSubAgentComplete 钩子（在子代理任务完成前）
				try {
					const hookResult = await unifiedHooksExecutor.executeHooks(
						'onSubAgentComplete',
						{
							agentId: agent.id,
							agentName: agent.name,
							content: finalResponse,
							success: true,
							usage: totalUsage,
						},
					);

					// 处理钩子返回结果
					if (hookResult.results && hookResult.results.length > 0) {
						let shouldContinue = false;

						for (const result of hookResult.results) {
							if (result.type === 'command' && !result.success) {
								if (result.exitCode >= 2) {
									// exitCode >= 2: 错误，追加消息并再次调用 API
									const errorMessage: ChatMessage = {
										role: 'user',
										content: result.error || result.output || '未知错误',
									};
									messages.push(errorMessage);
									shouldContinue = true;
								}
							} else if (result.type === 'prompt' && result.response) {
								// 处理 prompt 类型
								if (result.response.ask === 'ai' && result.response.continue) {
									// 发送给 AI 继续处理
									const promptMessage: ChatMessage = {
										role: 'user',
										content: result.response.message,
									};
									messages.push(promptMessage);
									shouldContinue = true;

									// 向 UI 显示钩子消息，告知用户子代理继续执行
									if (onMessage) {
										console.log(`Hook: ${result.response.message}`);
									}
								}
							}
						}
						// 如果需要继续，则不 break，让循环继续
						if (shouldContinue) {
							// 在继续前发送提示信息
							if (onMessage) {
								// 先发送一个 done 消息标记当前流结束
								onMessage({
									type: 'sub_agent_message',
									agentId: agent.id,
									agentName: agent.name,
									message: {
										type: 'done',
									},
								});
							}
							continue;
						}
					}
				} catch (error) {
					console.error('onSubAgentComplete hook execution failed:', error);
				}

				break;
			}

			// 拦截 askuser 工具：子智能体调用时需要显示主会话的蓝色边框 UI，而不是工具确认界面
			const askUserTool = toolCalls.find(tc =>
				tc.function.name.startsWith('askuser-'),
			);

			if (askUserTool && requestUserQuestion) {
				// 解析工具参数，失败时使用默认值
				let question = 'Please select an option:';
				let options: string[] = ['Yes', 'No'];

				try {
					const args = JSON.parse(askUserTool.function.arguments);
					if (args.question) question = args.question;
					if (args.options && Array.isArray(args.options)) {
						options = args.options;
					}
				} catch (error) {
					console.error('Failed to parse askuser tool arguments:', error);
				}

				const userAnswer = await requestUserQuestion(question, options);

				const answerText = userAnswer.customInput
					? `${userAnswer.selected}: ${userAnswer.customInput}`
					: userAnswer.selected;

				const toolResultMessage = {
					role: 'tool' as const,
					tool_call_id: askUserTool.id,
					content: JSON.stringify({
						answer: answerText,
						selected: userAnswer.selected,
						customInput: userAnswer.customInput,
					}),
				};

				messages.push(toolResultMessage);

				if (onMessage) {
					onMessage({
						type: 'sub_agent_message',
						agentId: agent.id,
						agentName: agent.name,
						message: {
							type: 'tool_result',
							tool_call_id: askUserTool.id,
							tool_name: askUserTool.function.name,
							content: JSON.stringify({
								answer: answerText,
								selected: userAnswer.selected,
								customInput: userAnswer.customInput,
							}),
						} as any,
					});
				}

				// 移除已处理的 askuser 工具，避免重复执行
				const remainingTools = toolCalls.filter(tc => tc.id !== askUserTool.id);

				if (remainingTools.length === 0) {
					continue;
				}

				toolCalls = remainingTools;
			}

			// Check tool approvals before execution
			const approvedToolCalls: typeof toolCalls = [];
			const rejectedToolCalls: typeof toolCalls = [];
			const rejectionReasons = new Map<string, string>(); // Map tool_call_id to rejection reason

			for (const toolCall of toolCalls) {
				const toolName = toolCall.function.name;
				let args: any;
				try {
					args = JSON.parse(toolCall.function.arguments);
				} catch (e) {
					args = {};
				}

				// Check if tool needs confirmation using the unified YOLO permission checker
				const permissionResult = await checkYoloPermission(
					toolName,
					args,
					yoloMode ?? false,
				);
				let needsConfirmation = permissionResult.needsConfirmation;

				// Check if tool is in auto-approved list (global or session)
				// This should override the YOLO permission check result
				if (
					sessionApprovedTools.has(toolName) ||
					(isToolAutoApproved && isToolAutoApproved(toolName))
				) {
					needsConfirmation = false;
				}

				if (needsConfirmation && requestToolConfirmation) {
					// Request confirmation from user
					const confirmation = await requestToolConfirmation(toolName, args);

					if (
						confirmation === 'reject' ||
						(typeof confirmation === 'object' &&
							confirmation.type === 'reject_with_reply')
					) {
						rejectedToolCalls.push(toolCall);
						// Save rejection reason if provided
						if (typeof confirmation === 'object' && confirmation.reason) {
							rejectionReasons.set(toolCall.id, confirmation.reason);
						}
						continue;
					}
					// If approve_always, add to both global and session lists
					if (confirmation === 'approve_always') {
						// Add to local session set (immediate effect)
						sessionApprovedTools.add(toolName);
						// Add to global list (persistent across sub-agent calls)
						if (addToAlwaysApproved) {
							addToAlwaysApproved(toolName);
						}
					}
				}

				approvedToolCalls.push(toolCall);
			}

			// Handle rejected tools - add rejection results to conversation instead of stopping
			if (rejectedToolCalls.length > 0) {
				const rejectionResults: ChatMessage[] = [];

				for (const toolCall of rejectedToolCalls) {
					// Get rejection reason if provided by user
					const rejectionReason = rejectionReasons.get(toolCall.id);
					const rejectMessage = rejectionReason
						? `Tool execution rejected by user: ${rejectionReason}`
						: 'Tool execution rejected by user';

					const toolResultMessage = {
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content: `Error: ${rejectMessage}`,
					};
					rejectionResults.push(toolResultMessage);

					// Send tool result to UI
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'tool_result',
								tool_call_id: toolCall.id,
								tool_name: toolCall.function.name,
								content: `Error: ${rejectMessage}`,
							} as any,
						});
					}
				}

				// Add rejection results to conversation
				messages.push(...rejectionResults);

				// If all tools were rejected and there are no approved tools, continue to next AI turn
				// The AI will see the rejection messages and can respond accordingly
				if (approvedToolCalls.length === 0) {
					continue;
				}

				// Otherwise, continue executing approved tools below
			}

			// Execute approved tool calls
			const toolResults: ChatMessage[] = [];
			for (const toolCall of approvedToolCalls) {
				// Check abort signal before executing each tool
				if (abortSignal?.aborted) {
					// Send done message to mark completion
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'done',
							},
						});
					}
					return {
						success: false,
						result: finalResponse,
						error: 'Sub-agent execution aborted during tool execution',
					};
				}

				try {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await executeMCPTool(
						toolCall.function.name,
						args,
						abortSignal,
					);

					const toolResult = {
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content: JSON.stringify(result),
					};
					toolResults.push(toolResult);

					// Send tool result to UI
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'tool_result',
								tool_call_id: toolCall.id,
								tool_name: toolCall.function.name,
								content: JSON.stringify(result),
							} as any,
						});
					}
				} catch (error) {
					const errorResult = {
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content: `Error: ${
							error instanceof Error ? error.message : 'Tool execution failed'
						}`,
					};
					toolResults.push(errorResult);

					// Send error result to UI
					if (onMessage) {
						onMessage({
							type: 'sub_agent_message',
							agentId: agent.id,
							agentName: agent.name,
							message: {
								type: 'tool_result',
								tool_call_id: toolCall.id,
								tool_name: toolCall.function.name,
								content: `Error: ${
									error instanceof Error
										? error.message
										: 'Tool execution failed'
								}`,
							} as any,
						});
					}
				}
			}

			// Add tool results to conversation
			messages.push(...toolResults);

			// Continue to next iteration if there were tool calls
			// The loop will continue until no more tool calls
		}

		return {
			success: true,
			result: finalResponse,
			usage: totalUsage,
		};
	} catch (error) {
		return {
			success: false,
			result: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}
