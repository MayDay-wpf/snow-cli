import {EventEmitter} from 'events';

export type UpdateNotice = {
	currentVersion: string;
	latestVersion: string;
	checkedAt: number;
};

const UPDATE_NOTICE_EVENT = 'update-notice';

const updateNoticeEmitter = new EventEmitter();
updateNoticeEmitter.setMaxListeners(20);

let currentNotice: UpdateNotice | null = null;

function compareVersion(a: string, b: string): number {
	const aParts = a.split('.').map(part => Number.parseInt(part, 10));
	const bParts = b.split('.').map(part => Number.parseInt(part, 10));
	const maxLength = Math.max(aParts.length, bParts.length);

	for (let index = 0; index < maxLength; index++) {
		const aPart = aParts[index] ?? 0;
		const bPart = bParts[index] ?? 0;

		if (aPart !== bPart) {
			return aPart - bPart;
		}
	}

	return 0;
}

export function setUpdateNotice(
	notice: Omit<UpdateNotice, 'checkedAt'> | null,
): void {
	currentNotice =
		notice && compareVersion(notice.latestVersion, notice.currentVersion) > 0
			? {...notice, checkedAt: Date.now()}
			: null;
	updateNoticeEmitter.emit(UPDATE_NOTICE_EVENT, currentNotice);
}

export function getUpdateNotice(): UpdateNotice | null {
	return currentNotice;
}

export function onUpdateNotice(
	handler: (notice: UpdateNotice | null) => void,
): () => void {
	updateNoticeEmitter.on(UPDATE_NOTICE_EVENT, handler);
	return () => {
		updateNoticeEmitter.off(UPDATE_NOTICE_EVENT, handler);
	};
}
