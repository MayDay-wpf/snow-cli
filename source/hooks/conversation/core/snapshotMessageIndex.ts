import type {ChatMessage} from '../../../api/chat.js';
import {convertSessionMessagesToUI} from '../../../utils/session/sessionConverter.js';

/**
 * File mutations happen after a user message is appended and persisted.
 * Snapshot records should therefore use the post-append UI boundary index.
 *
 * Rollback queries include snapshots whose index is greater than or equal to
 * the selected user-message index, so this boundary index correctly attaches
 * the following tool mutations to the user message that triggered them.
 */
export function getPostAppendSnapshotMessageIndex(
	sessionMessages: ChatMessage[],
): number {
	return convertSessionMessagesToUI(sessionMessages).length;
}
