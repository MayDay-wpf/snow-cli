import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import {useI18n} from '../../../i18n/I18nContext.js';

interface LogEntry {
	timestamp: string;
	level: 'info' | 'error' | 'success';
	message: string;
}

interface SSEServerStatusProps {
	port: number;
	workingDir?: string;
	onLogUpdate?: (
		callback: (message: string, level?: 'info' | 'error' | 'success') => void,
	) => void;
}

export const SSEServerStatus: React.FC<SSEServerStatusProps> = ({
	port,
	workingDir,
	onLogUpdate,
}) => {
	const {t} = useI18n();
	const [logs, setLogs] = useState<LogEntry[]>([]);

	useEffect(() => {
		if (onLogUpdate) {
			onLogUpdate(
				(message: string, level: 'info' | 'error' | 'success' = 'info') => {
					const timestamp = new Date().toLocaleTimeString('zh-CN', {
						hour12: false,
					});
					setLogs(prev => [...prev, {timestamp, level, message}]);
				},
			);
		}
	}, [onLogUpdate]);

	const getLevelColor = (level: string) => {
		switch (level) {
			case 'success':
				return 'green';
			case 'error':
				return 'red';
			default:
				return 'gray';
		}
	};

	return (
		<Box flexDirection="column">
			{/* 服务器状态 */}
			<Box>
				<Text bold color="green">
					{t.sseServer.started}
				</Text>
			</Box>

			{/* 服务器信息 */}
			<Box>
				<Text>{t.sseServer.port}: </Text>
				<Text color="cyan">{port}</Text>
				{workingDir && (
					<>
						<Text> | {t.sseServer.workingDir}: </Text>
						<Text color="yellow">{workingDir}</Text>
					</>
				)}
				<Text> | </Text>
				<Text color="green">● {t.sseServer.running}</Text>
			</Box>

			{/* 端点列表 */}
			<Box flexDirection="column">
				<Text dimColor>{t.sseServer.endpoints}:</Text>
				<Text color="blue"> http://localhost:{port}/events</Text>
				<Text color="blue"> POST http://localhost:{port}/message</Text>
				<Text color="blue"> POST http://localhost:{port}/session/create</Text>
				<Text color="blue"> POST http://localhost:{port}/session/load</Text>
				<Text color="blue"> GET http://localhost:{port}/session/list</Text>
				<Text color="blue">
					{' '}
					GET http://localhost:{port}
					/session/rollback-points?sessionId=:sessionId
				</Text>
				<Text color="blue">
					{' '}
					DELETE http://localhost:{port}/session/:sessionId
				</Text>
				<Text color="blue"> GET http://localhost:{port}/health</Text>
			</Box>

			{/* 运行日志 - 显示全部 */}
			<Box flexDirection="column">
				<Text dimColor>
					{t.sseServer.logs} ({logs.length}):
				</Text>
				<Box flexDirection="column">
					{logs.map((log, index) => (
						<Box key={index}>
							<Text dimColor>[{log.timestamp}] </Text>
							<Text color={getLevelColor(log.level)}>{log.message}</Text>
						</Box>
					))}
				</Box>
			</Box>

			{/* 提示 */}
			<Box>
				<Text dimColor>{t.sseServer.stopHint}</Text>
			</Box>
		</Box>
	);
};
