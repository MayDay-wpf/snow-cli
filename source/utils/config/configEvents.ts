import {EventEmitter} from 'events';

export type ConfigChangeEvent = {
	type: 'showThinking' | 'simpleMode' | 'other';
	value: any;
};

class ConfigEventEmitter extends EventEmitter {
	emitConfigChange(event: ConfigChangeEvent) {
		this.emit('config-change', event);
	}

	onConfigChange(callback: (event: ConfigChangeEvent) => void) {
		this.on('config-change', callback);
	}

	removeConfigChangeListener(callback: (event: ConfigChangeEvent) => void) {
		this.off('config-change', callback);
	}
}

export const configEvents = new ConfigEventEmitter();
