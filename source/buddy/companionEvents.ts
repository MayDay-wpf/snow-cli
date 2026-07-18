import {EventEmitter} from 'events';

export interface CompanionEventPayload {
	reaction?: string;
	petAt?: number;
	refresh?: boolean;
}

class CompanionEvents extends EventEmitter {
	emitChange(payload: CompanionEventPayload): void {
		this.emit('change', payload);
	}

	onChange(listener: (payload: CompanionEventPayload) => void): () => void {
		this.on('change', listener);
		return () => this.off('change', listener);
	}
}

export const companionEvents = new CompanionEvents();

export function companionReaction(text: string): void {
	companionEvents.emitChange({reaction: text});
}

export function companionPetAt(time = Date.now()): void {
	companionEvents.emitChange({petAt: time});
}

export function companionRefresh(): void {
	companionEvents.emitChange({refresh: true});
}
