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
	hookApiOnlyContext?: string;
	editorContext: ConversationHandlerOptions['editorContext'];
	imageContents: ConversationHandlerOptions['imageContents'];
	saveMessage: ConversationHandlerOptions['saveMessage'];
	abortSignal?: AbortSignal;
	/** Optional cwd for AGENTS discovery (defaults to process.cwd()). */
	cwd?: string;
}): Promise<void> {
	const {
		conversationMessages,
		userContent,
		hookApiOnlyContext,
		editorContext,
		imageContents,
		saveMessage,
		abortSignal,
		cwd,
	} = options;

	const processedVisionContent =
		await visionAgent.prepareContentForNonVisionModel(
			userContent,
			imageContents,
			{source: 'user', abortSignal},
		);

	// Session / history keep the clean user body (no AGENTS / no hook prepend).
	// Editor context + hook additionalContext + AGENTS only on live API payload.
	const persistedUserContent = processedVisionContent.content;
	const withEditorContext = buildEditorContextContent(
		editorContext,
		persistedUserContent,
	);

	let apiUserContent = withEditorContext;
	if (hookApiOnlyContext && hookApiOnlyContext.trim()) {
		try {
			const {prependAdditionalContext} = await import(
				'../../../utils/execution/hookContextInject.js'
			);
			apiUserContent = prependAdditionalContext(
				apiUserContent,
				hookApiOnlyContext,
			);
		} catch (error) {
			console.error('Failed to prepend hook additionalContext:', error);
		}
	}

	try {
		const {prependAgentsContext} = await import(
			'../../../prompt/contextInject/index.js'
		);
		// Respect settings profile (full/compact/off); enabled still gates inject.
		apiUserContent = prependAgentsContext(apiUserContent, {
			...(cwd ? {cwd} : {}),
		});
	} catch (error) {
		console.error('Failed to prepend AGENTS.md context:', error);
	}

	conversationMessages.push({
		role: 'user',
		content: apiUserContent,
		images: processedVisionContent.images,
	});

	try {
		await saveMessage({
			role: 'user',
			content: persistedUserContent,
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
