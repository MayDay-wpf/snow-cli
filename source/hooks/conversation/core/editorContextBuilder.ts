import {vscodeConnection} from '../../../utils/ui/vscodeConnection.js';

/**
 * Editor context structure
 */
export interface EditorContext {
	workspaceFolder?: string;
	activeFile?: string;
	cursorPosition?: {line: number; character: number};
	selectedText?: string;
}

/**
 * Resolve the human-readable name of the currently connected IDE
 * (e.g. "VSCode", "Cursor", "IntelliJ IDEA"). Falls back to a generic
 * "IDE" label when no matching IDE entry can be found — this keeps the
 * context informative without hard-coding any specific editor.
 */
function resolveConnectedIdeName(): string {
	try {
		const port = vscodeConnection.getPort();
		if (!port) {
			return 'IDE';
		}
		const {matched, unmatched} = vscodeConnection.getAvailableIDEs();
		const found =
			matched.find(ide => ide.port === port) ||
			unmatched.find(ide => ide.port === port);
		return found?.name || 'IDE';
	} catch {
		return 'IDE';
	}
}

/**
 * Build editor context string for AI
 *
 * Formats VSCode/IDE context information into a readable string
 * that will be prepended to user messages before sending to AI.
 *
 * @param editorContext - IDE context information
 * @param userContent - Original user message
 * @returns Final content with editor context prepended
 */
export function buildEditorContextContent(
	editorContext: EditorContext | undefined,
	userContent: string,
): string {
	if (!editorContext) {
		return userContent;
	}

	const editorLines: string[] = [];

	if (editorContext.workspaceFolder) {
		const ideName = resolveConnectedIdeName();
		editorLines.push(
			`└─ ${ideName} Workspace: ${editorContext.workspaceFolder}`,
		);
	}

	if (editorContext.activeFile) {
		editorLines.push(`└─ Active File: ${editorContext.activeFile}`);
	}

	// Cursor position is intentionally omitted from user messages: it is not a
	// reliable instruction target and makes the AI misjudge the user's focus.
	if (editorContext.selectedText) {
		editorLines.push(
			`└─ Selected Code:\n\`\`\`\n${editorContext.selectedText}\n\`\`\``,
		);
	}

	if (editorLines.length > 0) {
		return editorLines.join('\n') + '\n\n' + userContent;
	}

	return userContent;
}
