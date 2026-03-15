import type {ChatMessage} from '../../../api/chat.js';
import {
	collectAllMCPTools,
	getMCPServicesInfo,
	type MCPTool,
} from '../../../utils/execution/mcpToolsManager.js';
import {toolSearchService} from '../../../utils/execution/toolSearchService.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {initializeConversationSession} from './sessionInitializer.js';
import {buildEditorContextContent} from './editorContextBuilder.js';
import {cleanOrphanedToolCalls} from '../utils/messageCleanup.js';
import type {ConversationHandlerOptions} from './conversationTypes.js';

export type PreparedConversationSetup = {
	conversationMessages: ChatMessage[];
	activeTools: MCPTool[];
	discoveredToolNames: Set<string>;
	useToolSearch: boolean;
};

export async function prepareConversationSetup(
	options: Pick<
		ConversationHandlerOptions,
		'planMode' | 'vulnerabilityHuntingMode' | 'toolSearchDisabled'
	>,
): Promise<PreparedConversationSetup> {
	let {conversationMessages} = await initializeConversationSession(
		options.planMode || false,
		options.vulnerabilityHuntingMode || false,
		options.toolSearchDisabled || false,
	);

	const allMCPTools = await collectAllMCPTools();
	const servicesInfo = await getMCPServicesInfo();
	toolSearchService.updateRegistry(allMCPTools, servicesInfo);

	let activeTools: MCPTool[];
	let discoveredToolNames: Set<string>;
	const useToolSearch = !options.toolSearchDisabled;

	if (useToolSearch) {
		discoveredToolNames = toolSearchService.extractUsedToolNames(
			conversationMessages as any[],
		);
		activeTools = toolSearchService.buildActiveTools(discoveredToolNames);
	} else {
		discoveredToolNames = new Set<string>();
		activeTools = allMCPTools;
	}

	cleanOrphanedToolCalls(conversationMessages);

	return {
		conversationMessages,
		activeTools,
		discoveredToolNames,
		useToolSearch,
	};
}

export async function appendUserMessageAndSyncContext(options: {
	conversationMessages: ChatMessage[];
	userContent: string;
	editorContext: ConversationHandlerOptions['editorContext'];
	imageContents: ConversationHandlerOptions['imageContents'];
	saveMessage: ConversationHandlerOptions['saveMessage'];
}): Promise<void> {
	const {
		conversationMessages,
		userContent,
		editorContext,
		imageContents,
		saveMessage,
	} = options;

	const finalUserContent = buildEditorContextContent(editorContext, userContent);

	conversationMessages.push({
		role: 'user',
		content: finalUserContent,
		images: imageContents,
	});

	try {
		await saveMessage({
			role: 'user',
			content: userContent,
			images: imageContents,
		});
	} catch (error) {
		console.error('Failed to save user message:', error);
	}

	try {
		const {setConversationContext} = await import(
			'../../../utils/codebase/conversationContext.js'
		);
		const updatedSession = sessionManager.getCurrentSession();
		if (updatedSession) {
			const {convertSessionMessagesToUI} = await import(
				'../../../utils/session/sessionConverter.js'
			);
			const uiMessages = convertSessionMessagesToUI(updatedSession.messages);
			setConversationContext(updatedSession.id, uiMessages.length);
		}
	} catch (error) {
		console.error('Failed to set conversation context:', error);
	}
}
