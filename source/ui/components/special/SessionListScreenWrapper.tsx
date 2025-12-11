import React, {useEffect} from 'react';
import SessionListScreen from './SessionListScreen.js';

type Props = {
	onBack: () => void;
	onSelectSession: (sessionId: string) => void;
};

export default function SessionListScreenWrapper({
	onBack,
	onSelectSession,
}: Props) {
	useEffect(() => {
		process.stdout.write('\x1B[?1049h');
		process.stdout.write('\x1B[2J');
		process.stdout.write('\x1B[H');
		return () => {
			process.stdout.write('\x1B[2J');
			process.stdout.write('\x1B[?1049l');
		};
	}, []);

	return (
		<SessionListScreen onBack={onBack} onSelectSession={onSelectSession} />
	);
}
