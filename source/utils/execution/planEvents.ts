import {EventEmitter} from 'events';

export type PlanEvent = {
	type: 'plan-changed' | 'plan-archived' | 'plan-invalidated';
	planPath?: string;
	sessionId?: string | null;
	reason?: string;
};

class PlanEventEmitter extends EventEmitter {
	emitPlanEvent(event: PlanEvent) {
		this.emit('plan-event', event);
	}

	onPlanEvent(callback: (event: PlanEvent) => void) {
		this.on('plan-event', callback);
	}

	removePlanEventListener(callback: (event: PlanEvent) => void) {
		this.off('plan-event', callback);
	}
}

export const planEvents = new PlanEventEmitter();
