import { EventEmitter } from 'events';

// Global navigation event emitter
const navigationEmitter = new EventEmitter();

export const NAVIGATION_EVENT = 'navigate';

export interface NavigationEvent {
	destination: 'welcome' | 'chat' | 'settings' | 'config' | 'models' | 'mcp';
}

// Emit navigation event
export function navigateTo(destination: NavigationEvent['destination']) {
	navigationEmitter.emit(NAVIGATION_EVENT, { destination });
}

// Subscribe to navigation events
export function onNavigate(handler: (event: NavigationEvent) => void) {
	navigationEmitter.on(NAVIGATION_EVENT, handler);
	return () => {
		navigationEmitter.off(NAVIGATION_EVENT, handler);
	};
}
