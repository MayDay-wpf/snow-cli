import {useEffect, useState} from 'react';
import {registerCustomCommands} from '../../../utils/commands/custom.js';

export function useChatScreenCommands(workingDirectory: string) {
	const [commandsLoaded, setCommandsLoaded] = useState(false);

	useEffect(() => {
		let isMounted = true;

		Promise.all([
			import('../../../utils/commands/clear.js'),
			import('../../../utils/commands/delSession.js'),
			import('../../../utils/commands/profiles.js'),
			import('../../../utils/commands/hybridCompress.js'),
			import('../../../utils/commands/imageCompress.js'),
			import('../../../utils/commands/team.js'),
			import('../../../utils/commands/mcp.js'),
			import('../../../utils/commands/yolo.js'),
			import('../../../utils/commands/plan.js'),
			import('../../../utils/commands/init.js'),
			import('../../../utils/commands/ide.js'),
			import('../../../utils/commands/compact.js'),
			import('../../../utils/commands/home.js'),
			import('../../../utils/commands/review.js'),
			import('../../../utils/commands/gitline.js'),
			import('../../../utils/commands/role.js'),
			import('../../../utils/commands/roleSubagent.js'),
			import('../../../utils/commands/usage.js'),
			import('../../../utils/commands/export.js'),
			import('../../../utils/commands/config.js'),
			import('../../../utils/commands/agent.js'),
			import('../../../utils/commands/todoPicker.js'),
			import('../../../utils/commands/todolist.js'),
			import('../../../utils/commands/help.js'),
			import('../../../utils/commands/custom.js'),
			import('../../../utils/commands/skills.js'),
			import('../../../utils/commands/quit.js'),
			import('../../../utils/commands/reindex.js'),
			import('../../../utils/commands/codebase.js'),
			import('../../../utils/commands/addDir.js'),
			import('../../../utils/commands/agentsInject.js'),
			import('../../../utils/commands/permissions.js'),
			import('../../../utils/commands/branch.js'),
			import('../../../utils/commands/backend.js'),
			import('../../../utils/commands/loop.js'),
			import('../../../utils/commands/models.js'),
			import('../../../utils/commands/telemetry.js'),
			import('../../../utils/commands/subagentDepth.js'),
			import('../../../utils/commands/worktree.js'),
			import('../../../utils/commands/newPrompt.js'),
			import('../../../utils/commands/autoformat.js'),
			import('../../../utils/commands/toolsearch.js'),
			import('../../../utils/commands/ultraTodo.js'),
			import('../../../utils/commands/btw.js'),
			import('../../../utils/commands/deepresearch.js'),
			import('../../../utils/commands/pixel.js'),
			import('../../../utils/commands/games.js'),
			import('../../../utils/commands/toolDisplay.js'),
			import('../../../utils/commands/toolIcons.js'),
			import('../../../utils/commands/toolNames.js'),
			import('../../../utils/commands/thinkDisplay.js'),
			import('../../../utils/commands/subagentDisplay.js'),
			import('../../../utils/commands/display.js'),
			import('../../../utils/commands/speedometer.js'),
			import('../../../utils/commands/interrupt.js'),
		])
			.then(async () => {
				await registerCustomCommands(workingDirectory);
				if (isMounted) {
					setCommandsLoaded(true);
				}
			})
			.catch(error => {
				console.error('Failed to load commands:', error);
				if (isMounted) {
					setCommandsLoaded(true);
				}
			});

		return () => {
			isMounted = false;
		};
	}, [workingDirectory]);

	return commandsLoaded;
}
