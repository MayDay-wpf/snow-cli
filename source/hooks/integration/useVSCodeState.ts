import {useState, useEffect, useRef} from 'react';
import {
	vscodeConnection,
	type EditorContext,
} from '../../utils/ui/vscodeConnection.js';

export type VSCodeConnectionStatus =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'error';

export function useVSCodeState() {
	const [vscodeConnected, setVscodeConnected] = useState(false);
	const [vscodeConnectionStatus, setVscodeConnectionStatus] =
		useState<VSCodeConnectionStatus>('disconnected');
	const [editorContext, setEditorContext] = useState<EditorContext>({});

	// Use ref to track last status without causing re-renders
	const lastStatusRef = useRef<VSCodeConnectionStatus>('disconnected');
	// Use ref to track last editor context to avoid unnecessary updates
	const lastEditorContextRef = useRef<EditorContext>({});

	// Monitor VSCode connection status and editor context
	useEffect(() => {
		const checkConnectionInterval = setInterval(() => {
			const isConnected = vscodeConnection.isConnected();
			setVscodeConnected(isConnected);

			// Update connection status based on actual connection state
			// Use ref to avoid reading from state
			if (isConnected && lastStatusRef.current !== 'connected') {
				lastStatusRef.current = 'connected';
				setVscodeConnectionStatus('connected');
			} else if (!isConnected && lastStatusRef.current === 'connected') {
				lastStatusRef.current = 'disconnected';
				setVscodeConnectionStatus('disconnected');
			}
		}, 1000); // Check every second

		const unsubscribe = vscodeConnection.onContextUpdate(context => {
			// Only update state if context has actually changed
			const hasChanged =
				context.activeFile !== lastEditorContextRef.current.activeFile ||
				context.selectedText !== lastEditorContextRef.current.selectedText ||
				context.cursorPosition?.line !==
					lastEditorContextRef.current.cursorPosition?.line ||
				context.cursorPosition?.character !==
					lastEditorContextRef.current.cursorPosition?.character ||
				context.workspaceFolder !==
					lastEditorContextRef.current.workspaceFolder;

			if (hasChanged) {
				lastEditorContextRef.current = context;
				setEditorContext(context);
			}

			// When we receive context, it means connection is successful
			if (lastStatusRef.current !== 'connected') {
				lastStatusRef.current = 'connected';
				setVscodeConnectionStatus('connected');
			}
		});

		return () => {
			clearInterval(checkConnectionInterval);
			unsubscribe();
		};
	}, []); // Remove vscodeConnectionStatus from dependencies

	// Separate effect for handling connecting timeout
	useEffect(() => {
		if (vscodeConnectionStatus !== 'connecting') {
			return;
		}

		// Set timeout for connecting state (15 seconds to allow for port scanning and connection)
		const connectingTimeout = setTimeout(() => {
			const isConnected = vscodeConnection.isConnected();
			const isClientRunning = vscodeConnection.isClientRunning();

			// Only set error if still not connected after timeout
			if (!isConnected) {
				if (isClientRunning) {
					// Client is running but no connection - show error with helpful message
					setVscodeConnectionStatus('error');
				} else {
					// Client not running - go back to disconnected
					setVscodeConnectionStatus('disconnected');
				}
				lastStatusRef.current = isClientRunning ? 'error' : 'disconnected';
			}
		}, 15000); // 15 seconds: 10s for connection timeout + 5s buffer

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
