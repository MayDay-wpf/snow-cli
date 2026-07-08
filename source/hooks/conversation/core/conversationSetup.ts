import type {ChatMessage} from '../../../api/chat.js';
import {
	collectAllMCPTools,
	getMCPServicesInfo,
	type MCPTool,
} from '../../../utils/execution/mcpToolsManager.js';
import {toolSearchService} from '../../../utils/execution/toolSearchService.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {initializeConversationSession} from './sessionInitializer.js';
import {getPostAppendSnapshotMessageIndex} from './snapshotMessageIndex.js';
import {buildEditorContextContent} from './editorContextBuilder.js';
import {cleanOrphanedToolCalls} from '../utils/messageCleanup.js';
import type {ConversationHandlerOptions} from './conversationTypes.js';
import {visionAgent} from '../../../agents/visionAgent.js';

export type PreparedConversationSetup = {
	conversationMessages: ChatMessage[];
	activeTools: MCPTool[];
	discoveredToolNames: Set<string>;
	useToolSearch: boolean;
};

export async function prepareConversationSetup(
	options: Pick<
		ConversationHandlerOptions,
		'planMode' | 'vulnerabilityHuntingMode' | 'teamMode' | 'toolSearchDisabled'
	>,
): Promise<PreparedConversationSetup> {
	let {conversationMessages} = await initializeConversationSession(
		options.planMode || false,
		options.vulnerabilityHuntingMode || false,
		options.toolSearchDisabled || false,
		options.teamMode || false,
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
	abortSignal?: AbortSignal;
}): Promise<void> {
	const {
		conversationMessages,
		userContent,
		editorContext,
		imageContents,
		saveMessage,
		abortSignal,
	} = options;

	const processedVisionContent =
		await visionAgent.prepareContentForNonVisionModel(
			userContent,
			imageContents,
			{source: 'user', abortSignal},
		);

	const finalUserContent = buildEditorContextContent(
		editorContext,
		processedVisionContent.content,
	);

	conversationMessages.push({
		role: 'user',
		content: finalUserContent,
		images: processedVisionContent.images,
	});

	try {
		await saveMessage({
			role: 'user',
			content: processedVisionContent.content,
			images: processedVisionContent.images,
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
			const snapshotMessageIndex = getPostAppendSnapshotMessageIndex(
				updatedSession.messages,
			);
			setConversationContext(updatedSession.id, snapshotMessageIndex);
		}
	} catch (error) {
		console.error('Failed to set conversation context:', error);
	}
}
