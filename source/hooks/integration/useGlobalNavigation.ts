import {EventEmitter} from 'events';

// Global navigation event emitter
const navigationEmitter = new EventEmitter();
// Increase max listeners to prevent warnings, but not unlimited to catch real leaks
navigationEmitter.setMaxListeners(20);

export const NAVIGATION_EVENT = 'navigate';

export interface NavigationEvent {
	destination:
		| 'welcome'
		| 'chat'
		| 'help'
		| 'settings'
		| 'mcp'
		| 'systemprompt'
		| 'customheaders';
}

// Emit navigation event
export function navigateTo(destination: NavigationEvent['destination']) {
	navigationEmitter.emit(NAVIGATION_EVENT, {destination});
}

// Subscribe to navigation events
export function onNavigate(handler: (event: NavigationEvent) => void) {
	navigationEmitter.on(NAVIGATION_EVENT, handler);
	return () => {
		navigationEmitter.off(NAVIGATION_EVENT, handler);
	};
}
