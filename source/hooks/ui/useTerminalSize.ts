import {useEffect, useState} from 'react';

// Singleton pattern to avoid MaxListenersExceededWarning
// All components share a single resize listener instead of each adding their own
type SizeListener = (size: {columns: number; rows: number}) => void;

const listeners = new Set<SizeListener>();
let isListening = false;
let currentSize = {
	columns: process.stdout.columns || 80,
	rows: process.stdout.rows || 20,
};

function handleResize() {
	currentSize = {
		columns: process.stdout.columns || 80,
		rows: process.stdout.rows || 20,
	};
	listeners.forEach(listener => listener(currentSize));
}

function subscribe(listener: SizeListener): () => void {
	listeners.add(listener);

	// Start listening only when first subscriber joins
	if (!isListening) {
		isListening = true;
		process.stdout.on('resize', handleResize);
	}

	// Return unsubscribe function
	return () => {
		listeners.delete(listener);

		// Stop listening when last subscriber leaves
		if (listeners.size === 0 && isListening) {
			isListening = false;
			process.stdout.off('resize', handleResize);
		}
	};
}

export function useTerminalSize(): {columns: number; rows: number} {
	const [size, setSize] = useState(currentSize);

	useEffect(() => {
		// Sync with current size in case it changed before mount
		setSize(currentSize);

		// Subscribe to size changes
		const unsubscribe = subscribe(setSize);
		return unsubscribe;
	}, []);

	return size;
}
