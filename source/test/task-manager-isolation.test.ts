import anyTest, {type TestFn} from 'ava';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {TaskManager} from '../utils/task/taskManager.js';

const test = anyTest as unknown as TestFn;

function manager(snowDir: string, projectId: string) {
	return new TaskManager({
		snowDir,
		projectIdentity: {projectId, projectPath: `E:/${projectId}`},
	});
}

test('project-scoped tasks stay out of another project default list', async t => {
	const snowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-task-test-'));
	t.teardown(() => fs.rm(snowDir, {recursive: true, force: true}));
	const projectA = manager(snowDir, 'project-a-123456');
	const projectB = manager(snowDir, 'project-b-654321');
	const task = await projectA.createTask('project A task');

	t.is((await projectB.listTasks()).length, 0);
	const globalTasks = await projectB.listTasks('all');
	t.is(globalTasks.length, 1);
	t.is(globalTasks[0]?.id, task.id);
	t.is(globalTasks[0]?.projectId, 'project-a-123456');
});

test('concurrent managers preserve status and messages', async t => {
	const snowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-task-test-'));
	t.teardown(() => fs.rm(snowDir, {recursive: true, force: true}));
	const first = manager(snowDir, 'project-a-123456');
	const second = manager(snowDir, 'project-a-123456');
	const task = await first.createTask('concurrent task');

	await Promise.all([
		first.updateTaskStatus(task.id, 'running'),
		second.addMessage(task.id, {
			role: 'user',
			content: 'message',
			timestamp: Date.now(),
		}),
	]);

	const updated = await first.loadTask(task.id);
	t.is(updated?.status, 'running');
	t.is(updated?.messages.length, 1);
});

test('refuses to signal a PID not belonging to the task executor', async t => {
	const snowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-task-test-'));
	t.teardown(() => fs.rm(snowDir, {recursive: true, force: true}));
	const taskManager = new TaskManager({
		snowDir,
		projectIdentity: {
			projectId: 'project-a-123456',
			projectPath: 'E:/project-a',
		},
		inspectProcess: async () => 'node unrelated-process.js',
	});
	const task = await taskManager.createTask('protected task');
	await taskManager.setTaskPid(task.id, process.pid);

	t.false(await taskManager.deleteTask(task.id));
	t.truthy(await taskManager.loadTask(task.id));
});
