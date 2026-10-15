import test from 'ava';
import {generatePerceptualTheme} from '../utils/color-science/engine.js';

test('Lifecycle & Resources: memory leak safety under high-frequency sliding (10,000 derivations)', t => {
	// 强制垃圾回收预热 (如果支持)
	if (global.gc) {
		global.gc();
	}
	const memBefore = process.memoryUsage().heapUsed;

	// 模拟极端情况下用户连续按住 Shift + 方向键极速狂滑 10,000 次推导
	for (let i = 0; i < 10000; i++) {
		generatePerceptualTheme({
			hue: (i * 3) % 360,
			chroma: 0.15,
			mood: i % 2 === 0 ? 'slate' : 'neon',
		});
	}

	if (global.gc) {
		global.gc();
	}
	const memAfter = process.memoryUsage().heapUsed;
	const diffMb = (memAfter - memBefore) / 1024 / 1024;

	// 10,000 次推导不应发生堆内存不可控泄露，增量应极小 (< 10MB)
	t.true(
		diffMb < 10,
		`Heap growth was too high: ${diffMb.toFixed(2)} MB after 10k derivations`,
	);
});

test('Lifecycle & Resources: zero external handles or timers created by color engine', t => {
	// 检查当前进程的活跃句柄与定时器
	// @ts-ignore
	const activeHandlesBefore = process._getActiveHandles ? process._getActiveHandles().length : 0;

	generatePerceptualTheme({
		hue: 180,
		chroma: 0.12,
		mood: 'charcoal',
	});

	// @ts-ignore
	const activeHandlesAfter = process._getActiveHandles ? process._getActiveHandles().length : 0;

	// 纯纯函数推导，绝对严禁持有任何未释放的定时器、文件描述符或子进程句柄
	t.is(
		activeHandlesAfter,
		activeHandlesBefore,
		'Color engine must not allocate unreleased handles or timers',
	);
});
