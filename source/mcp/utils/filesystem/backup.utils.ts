type BackupFileParams = {
	filePath: string;
	basePath: string;
	fileExisted: boolean;
	originalContent?: string;
};

/**
 * Best-effort snapshot backup before mutating files.
 * Failures are intentionally swallowed to avoid blocking edits.
 */
export async function backupFileBeforeMutation(
	params: BackupFileParams,
): Promise<void> {
	try {
		const {getConversationContext} = await import(
			'../../../utils/codebase/conversationContext.js'
		);
		const context = getConversationContext();
		if (!context) {
			return;
		}

		const {hashBasedSnapshotManager} = await import(
			'../../../utils/codebase/hashBasedSnapshot.js'
		);
		await hashBasedSnapshotManager.backupFile(
			context.sessionId,
			context.messageIndex,
			params.filePath,
			params.basePath,
			params.fileExisted,
			params.originalContent,
		);
	} catch {
		// non-fatal
	}
}
