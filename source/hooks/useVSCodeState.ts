import {useState, useEffect} from 'react';
import {vscodeConnection, type EditorContext} from '../utils/vscodeConnection.js';

export type VSCodeConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useVSCodeState() {
	const [vscodeConnected, setVscodeConnected] = useState(false);
	const [vscodeConnectionStatus, setVscodeConnectionStatus] = useState<VSCodeConnectionStatus>('disconnected');
	const [editorContext, setEditorContext] = useState<EditorContext>({});

	// Monitor VSCode connection status and editor context
	useEffect(() => {
		const checkConnectionInterval = setInterval(() => {
			const isConnected = vscodeConnection.isConnected();
			setVscodeConnected(isConnected);

			// Update connection status based on actual connection state
			if (isConnected && vscodeConnectionStatus !== 'connected') {
				setVscodeConnectionStatus('connected');
			} else if (!isConnected && vscodeConnectionStatus === 'connected') {
				setVscodeConnectionStatus('disconnected');
			}
		}, 1000);

		const unsubscribe = vscodeConnection.onContextUpdate(context => {
			setEditorContext(context);
			// When we receive context, it means connection is successful
			if (vscodeConnectionStatus !== 'connected') {
				setVscodeConnectionStatus('connected');
			}
		});

		return () => {
			clearInterval(checkConnectionInterval);
			unsubscribe();
		};
	}, [vscodeConnectionStatus]);

	// Separate effect for handling connecting timeout
	useEffect(() => {
		if (vscodeConnectionStatus !== 'connecting') {
			return;
		}

		// Set timeout for connecting state (30 seconds to allow for VSCode extension reconnection)
		const connectingTimeout = setTimeout(() => {
			const isConnected = vscodeConnection.isConnected();
			const isServerRunning = vscodeConnection.isServerRunning();

			// Only set error if still not connected after timeout
			if (!isConnected) {
				if (isServerRunning) {
					// Server is running but no connection - show error with helpful message
					setVscodeConnectionStatus('error');
				} else {
					// Server not running - go back to disconnected
					setVscodeConnectionStatus('disconnected');
				}
			}
		}, 30000); // Increased to 30 seconds

		return () => {
			clearTimeout(connectingTimeout);
		};
	}, [vscodeConnectionStatus]);

	return {
		vscodeConnected,
		vscodeConnectionStatus,
		setVscodeConnectionStatus,
		editorContext,
	};
}
