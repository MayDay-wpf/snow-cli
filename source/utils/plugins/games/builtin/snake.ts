/**
 * 内置贪吃蛇游戏插件。
 *
 * 作为 GamePlugin 的参考实现，演示完整的游戏循环：
 * init → handleInput/tick → render → getStatus。
 *
 * 游戏规则：
 *   - 方向键控制蛇移动方向
 *   - 吃到食物得分并增长
 *   - 撞墙或撞自己则游戏结束
 *   - ESC 退出
 */
import type {
	GameInitContext,
	GameInput,
	GamePlugin,
	GameRenderResult,
	GameStatus,
} from '../types.js';

interface Point {
	x: number;
	y: number;
}

type Direction = 'up' | 'down' | 'left' | 'right';

interface SnakeGameState {
	width: number;
	height: number;
	snake: Point[];
	direction: Direction;
	/**
	 * 输入缓冲队列。handleInput 将合法方向追加到此队列，
	 * tick 每次 tick 消费一个，确保一帧只转向一次，
	 * 避免快速连按方向键导致 180 度反转撞自己。
	 */
	directionQueue: Direction[];
	food: Point;
	score: number;
	status: GameStatus;
}

const GRID_WIDTH = 20;
const GRID_HEIGHT = 12;
const TICK_INTERVAL_MS = 200;
/** 方向队列上限，避免无意义堆积 */
const MAX_QUEUE_SIZE = 3;

const OPPOSITE: Record<Direction, Direction> = {
	up: 'down',
	down: 'up',
	left: 'right',
	right: 'left',
};

function randomFood(state: SnakeGameState): Point {
	let food: Point;
	do {
		food = {
			x: Math.floor(Math.random() * state.width),
			y: Math.floor(Math.random() * state.height),
		};
	} while (state.snake.some(seg => seg.x === food.x && seg.y === food.y));
	return food;
}

function initSnakeState(ctx: GameInitContext): SnakeGameState {
	const width = Math.min(GRID_WIDTH, Math.max(10, ctx.terminalWidth - 4));
	const height = GRID_HEIGHT;
	const startX = Math.floor(width / 2);
	const startY = Math.floor(height / 2);
	const snake: Point[] = [
		{x: startX, y: startY},
		{x: startX - 1, y: startY},
		{x: startX - 2, y: startY},
	];
	const state: SnakeGameState = {
		width,
		height,
		snake,
		direction: 'right',
		directionQueue: [],
		food: {x: 0, y: 0},
		score: 0,
		status: 'playing',
	};
	state.food = randomFood(state);
	return state;
}

function nextHead(snake: Point[], direction: Direction): Point {
	const head = snake[0]!;
	switch (direction) {
		case 'up':
			return {x: head.x, y: head.y - 1};
		case 'down':
			return {x: head.x, y: head.y + 1};
		case 'left':
			return {x: head.x - 1, y: head.y};
		case 'right':
			return {x: head.x + 1, y: head.y};
	}
}

function tickSnake(state: SnakeGameState): SnakeGameState | null {
	if (state.status !== 'playing') {
		return null;
	}

	// 消费方向队列：每 tick 最多应用一次转向
	let direction = state.direction;
	let directionQueue = state.directionQueue;
	if (directionQueue.length > 0) {
		const next = directionQueue[0]!;
		directionQueue = directionQueue.slice(1);
		// 二次校验，防止 180 度反转
		if (next !== OPPOSITE[direction]) {
			direction = next;
		}
	}

	const head = nextHead(state.snake, direction);

	// 撞墙检测
	if (
		head.x < 0 ||
		head.x >= state.width ||
		head.y < 0 ||
		head.y >= state.height
	) {
		return {...state, status: 'gameover'};
	}

	// 撞自身检测
	if (state.snake.some(seg => seg.x === head.x && seg.y === head.y)) {
		return {...state, status: 'gameover'};
	}

	const newSnake = [head, ...state.snake];

	// 吃到食物
	if (head.x === state.food.x && head.y === state.food.y) {
		const newScore = state.score + 10;
		const newFood = randomFood({...state, snake: newSnake});
		return {
			...state,
			snake: newSnake,
			direction,
			directionQueue,
			food: newFood,
			score: newScore,
		};
	}

	// 正常移动——尾部移除
	newSnake.pop();
	return {...state, snake: newSnake, direction, directionQueue};
}

function handleInputSnake(
	state: SnakeGameState,
	input: GameInput,
): SnakeGameState {
	// ESC 和暂停（p 键）由 GameRunner 引擎层统一处理，插件不再拦截
	if (state.status === 'gameover') {
		// 游戏结束后按 Enter 重新开始
		if (input.key.return) {
			return initSnakeState({
				terminalWidth: state.width + 4,
				terminalHeight: state.height + 6,
			});
		}
		return state;
	}

	if (state.status !== 'playing') {
		return state;
	}

	const dir: Direction | null = input.key.upArrow
		? 'up'
		: input.key.downArrow
		? 'down'
		: input.key.leftArrow
		? 'left'
		: input.key.rightArrow
		? 'right'
		: null;

	if (dir === null) {
		return state;
	}

	// 参考方向：队列最后一个，或当前方向
	const refDir =
		state.directionQueue.length > 0
			? state.directionQueue[state.directionQueue.length - 1]!
			: state.direction;

	// 不允许 180 度反转，也不允许与参考方向相同（无意义的重复入队）
	if (dir === refDir || dir === OPPOSITE[refDir]) {
		return state;
	}

	// 限制队列长度，避免无限堆积
	if (state.directionQueue.length >= MAX_QUEUE_SIZE) {
		return state;
	}

	return {
		...state,
		directionQueue: [...state.directionQueue, dir],
	};
}

function renderSnake(state: SnakeGameState): GameRenderResult {
	const lines: string[] = [];
	const chars = {
		head: 'O',
		body: 'o',
		food: '*',
		empty: ' ',
		borderH: '-',
		borderV: '|',
		corner: '+',
	};

	// 上边界
	lines.push(chars.corner + chars.borderH.repeat(state.width) + chars.corner);

	for (let y = 0; y < state.height; y++) {
		let row = chars.borderV;
		for (let x = 0; x < state.width; x++) {
			if (x === state.food.x && y === state.food.y) {
				row += chars.food;
			} else if (x === state.snake[0]!.x && y === state.snake[0]!.y) {
				row += chars.head;
			} else if (
				state.snake.some((seg, idx) => idx > 0 && seg.x === x && seg.y === y)
			) {
				row += chars.body;
			} else {
				row += chars.empty;
			}
		}
		row += chars.borderV;
		lines.push(row);
	}

	// 下边界
	lines.push(chars.corner + chars.borderH.repeat(state.width) + chars.corner);

	return lines;
}

function getStatusSnake(state: SnakeGameState): GameStatus {
	return state.status;
}

function getHintSnake(state: SnakeGameState): string {
	if (state.status === 'gameover') {
		return 'Game Over! Press Enter to restart, ESC to exit.';
	}
	return 'Arrow keys to move. Eat * to grow. P to pause. ESC to exit.';
}

function getScoreSnake(state: SnakeGameState): string | null {
	return `Score: ${state.score}`;
}

export const snakeGamePlugin: GamePlugin<SnakeGameState> = {
	id: 'builtin.snake',
	name: 'Snake',
	tickInterval: TICK_INTERVAL_MS,
	description: {
		en: 'Classic snake game. Eat food to grow, avoid walls and yourself.',
		zh: '经典贪吃蛇游戏。吃食物成长，避免撞墙和撞到自己。',
		'zh-TW': '經典貪吃蛇遊戲。吃食物成長，避免撞牆和撞到自己。',
	},
	author: 'Snow CLI',
	version: '1.0.0',
	enable: true,
	init: initSnakeState,
	handleInput: handleInputSnake,
	tick: tickSnake,
	render: renderSnake,
	getStatus: getStatusSnake,
	getHint: getHintSnake,
	getScore: getScoreSnake,
};

/** Tick interval exposed for GameRunner */
export const SNAKE_TICK_INTERVAL_MS = TICK_INTERVAL_MS;
