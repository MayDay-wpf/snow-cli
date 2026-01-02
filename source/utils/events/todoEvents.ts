import {EventEmitter} from 'events';
import type {TodoItem} from '../../mcp/types/todo.types.js';

/**
 * TODO 事件管理器 - 使用事件驱动模式替代轮询
 */
class TodoEventEmitter extends EventEmitter {
	/**
	 * 触发 TODO 更新事件
	 */
	emitTodoUpdate(sessionId: string, todos: TodoItem[]) {
		this.emit('todo-update', {sessionId, todos});
	}

	/**
	 * 监听 TODO 更新事件
	 */
	onTodoUpdate(
		callback: (data: {sessionId: string; todos: TodoItem[]}) => void,
	) {
		this.on('todo-update', callback);
	}

	/**
	 * 移除 TODO 更新监听器
	 */
	offTodoUpdate(
		callback: (data: {sessionId: string; todos: TodoItem[]}) => void,
	) {
		this.off('todo-update', callback);
	}
}

export const todoEvents = new TodoEventEmitter();
