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

export function setUpdateNotice(notice: Omit<UpdateNotice, 'checkedAt'> | null): void {
	currentNotice = notice ? {...notice, checkedAt: Date.now()} : null;
	updateNoticeEmitter.emit(UPDATE_NOTICE_EVENT, currentNotice);
}

export function getUpdateNotice(): UpdateNotice | null {
	return currentNotice;
}

export function onUpdateNotice(handler: (notice: UpdateNotice | null) => void): () => void {
	updateNoticeEmitter.on(UPDATE_NOTICE_EVENT, handler);
	return () => {
		updateNoticeEmitter.off(UPDATE_NOTICE_EVENT, handler);
	};
}
