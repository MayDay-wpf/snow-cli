import {encoding_for_model} from 'tiktoken';
import {resourceMonitor} from '../../../utils/core/resourceMonitor.js';

/**
 * Encoder manager for token counting
 */
export class EncoderManager {
	private encoder: any;
	private freed = false;

	constructor() {
		try {
			this.encoder = encoding_for_model('gpt-5');
			resourceMonitor.trackEncoderCreated();
		} catch (e) {
			this.encoder = encoding_for_model('gpt-3.5-turbo');
			resourceMonitor.trackEncoderCreated();
		}
	}

	/**
	 * Encode text to tokens
	 */
	encode(text: string): number[] {
		if (this.freed) {
			throw new Error('Encoder has been freed');
		}
		return this.encoder.encode(text);
	}

	/**
	 * Free encoder resources
	 */
	free(): void {
		if (!this.freed && this.encoder) {
			try {
				this.encoder.free();
				this.freed = true;
				resourceMonitor.trackEncoderFreed();
			} catch (e) {
				console.error('Failed to free encoder:', e);
			}
		}
	}

	/**
	 * Check if encoder has been freed
	 */
	isFreed(): boolean {
		return this.freed;
	}
}
