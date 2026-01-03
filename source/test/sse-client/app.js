// ============================================================================
// Snow AI SSE 客户端测试 - 主逻辑
// ============================================================================

// ----------------------------------------------------------------------------
// 全局状态
// ----------------------------------------------------------------------------
let eventSource = null; // SSE 连接实例
let serverUrl = 'http://localhost:3000';
let currentSessionId = null; // 当前会话 ID
let selectedImages = []; // 待发送的图片（Base64 data URI）数组

// 会话列表 UI 状态
const sessionListState = {
	page: 0,
	pageSize: 20,
	q: '', // 搜索关键词
	loading: false,
	sessions: [],
	total: 0,
	hasMore: false,
	selectedSessionId: null,
	_lastRequestKey: '', // 防止旧请求覆盖新请求
	_searchDebounceTimer: null,
};

// ----------------------------------------------------------------------------
// 工具函数
// ----------------------------------------------------------------------------

// DOM 快捷访问
function byId(id) {
	return document.getElementById(id);
}

// HTML 转义（防 XSS）
function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

// 时间格式化
function formatTime(ts) {
	if (!ts) return '';
	try {
		return new Date(ts).toLocaleString();
	} catch {
		return String(ts);
	}
}

// 文本摘要（120字截断）
function summarizeText(text) {
	if (!text) return '';
	const normalized = String(text).replace(/\s+/g, ' ').trim();
	return normalized.length > 120 ? normalized.slice(0, 120) + '…' : normalized;
}

// 标准化聊天消息内容（支持 string 和多模态数组）
function normalizeChatMessageContent(msg) {
	const c = msg?.content;
	if (typeof c === 'string') return c;
	if (Array.isArray(c)) {
		const texts = c
			.map(p => {
				if (!p) return '';
				if (typeof p.text === 'string') return p.text;
				if (p.type === 'image_url' && p.image_url?.url) return '[图片]';
				return '';
			})
			.filter(Boolean);
		return texts.join('\n').trim();
	}
	if (c == null) return '';
	return String(c);
}

// ----------------------------------------------------------------------------
// 会话列表 UI
// ----------------------------------------------------------------------------

// 控制会话列表按钮的启用/禁用
function setSessionControlsEnabled(enabled) {
	byId('refreshSessionsBtn').disabled = !enabled;
	byId('loadSelectedSessionBtn').disabled =
		!enabled || !sessionListState.selectedSessionId;
	byId('deleteSelectedSessionBtn').disabled =
		!enabled || !sessionListState.selectedSessionId;
	byId('prevPageBtn').disabled =
		!enabled || sessionListState.page <= 0 || sessionListState.loading;
	byId('nextPageBtn').disabled =
		!enabled || !sessionListState.hasMore || sessionListState.loading;
}

// 渲染会话列表到右侧面板
function renderSessionList() {
	const listEl = byId('sessionsList');
	const metaEl = byId('sessionsMeta');

	const {page, pageSize, q, total, sessions, hasMore, loading} =
		sessionListState;
	const shownStart = total === 0 ? 0 : page * pageSize + 1;
	const shownEnd = Math.min(total, page * pageSize + sessions.length);
	const qLabel = q.trim() ? `，搜索: ${q.trim()}` : '';
	metaEl.textContent = loading
		? '加载中...'
		: `共 ${total} 条，显示 ${shownStart}-${shownEnd}，第 ${
				page + 1
		  } 页${qLabel}`;

	listEl.innerHTML = '';
	if (!sessions || sessions.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'session-item';
		empty.style.cursor = 'default';
		empty.textContent = loading ? '加载中...' : '无结果';
		listEl.appendChild(empty);
		return;
	}

	sessions.forEach(s => {
		const item = document.createElement('div');
		item.className =
			'session-item' +
			(s.id === sessionListState.selectedSessionId ? ' selected' : '');
		item.onclick = () => selectSession(s.id);

		const title = s.title || '(无标题)';
		const summary = s.summary || '';
		const msgCount =
			typeof s.messageCount === 'number' ? s.messageCount : undefined;
		const timeText = formatTime(s.updatedAt || s.createdAt);
		const msgSuffix = msgCount !== undefined ? ` · 消息: ${msgCount}` : '';

		item.innerHTML = `
			<div class="row1">
				<div class="title">${escapeHtml(title)}</div>
				<div class="time">${escapeHtml(timeText)}</div>
			</div>
			<div class="row2">${escapeHtml(summarizeText(summary))}</div>
			<div class="row3">ID: ${escapeHtml(s.id)}${escapeHtml(msgSuffix)}</div>
		`;

		listEl.appendChild(item);
	});
}

// 选中某个会话
function selectSession(sessionId) {
	sessionListState.selectedSessionId = sessionId;
	renderSessionList();
	setSessionControlsEnabled(!!eventSource);
}

// 从服务端加载会话列表
async function refreshSessionList() {
	if (!eventSource) return;
	if (sessionListState.loading) return;

	const params = new URLSearchParams();
	params.set('page', String(Math.max(0, sessionListState.page)));
	params.set('pageSize', String(Math.max(1, sessionListState.pageSize)));
	if (sessionListState.q.trim()) params.set('q', sessionListState.q.trim());

	const requestKey = params.toString();
	sessionListState._lastRequestKey = requestKey;
	sessionListState.loading = true;
	renderSessionList();
	setSessionControlsEnabled(true);

	try {
		const response = await fetch(
			`${serverUrl}/session/list?${params.toString()}`,
		);
		const data = await response.json();
		logEvent('SESSION_LIST', data, !response.ok);

		// 防止旧请求覆盖新请求
		if (sessionListState._lastRequestKey !== requestKey) {
			return;
		}

		if (!response.ok || !data?.success) {
			sessionListState.sessions = [];
			sessionListState.total = 0;
			sessionListState.hasMore = false;
			return;
		}

		sessionListState.sessions = Array.isArray(data.sessions)
			? data.sessions
			: [];
		sessionListState.total = typeof data.total === 'number' ? data.total : 0;
		sessionListState.hasMore = !!data.hasMore;
	} catch (error) {
		logEvent('SESSION_LIST_ERROR', {message: error.message}, true);
	} finally {
		if (sessionListState._lastRequestKey === requestKey) {
			sessionListState.loading = false;
			renderSessionList();
			setSessionControlsEnabled(true);
		}
	}
}

// 搜索变化时的防抖处理
function onSessionSearchChange() {
	const v = byId('sessionSearchInput').value || '';
	sessionListState.q = v;
	sessionListState.page = 0;
	if (sessionListState._searchDebounceTimer) {
		clearTimeout(sessionListState._searchDebounceTimer);
	}
	sessionListState._searchDebounceTimer = setTimeout(() => {
		refreshSessionList();
	}, 250);
}

// 每页数量变化
function onSessionPageSizeChange() {
	const v = Number.parseInt(byId('sessionPageSize').value, 10);
	sessionListState.pageSize = Number.isFinite(v) && v > 0 ? v : 20;
	sessionListState.page = 0;
	refreshSessionList();
}

// 上一页
function prevSessionPage() {
	if (sessionListState.page <= 0) return;
	sessionListState.page -= 1;
	refreshSessionList();
}

// 下一页
function nextSessionPage() {
	if (!sessionListState.hasMore) return;
	sessionListState.page += 1;
	refreshSessionList();
}

// 加载选中会话到聊天框
async function loadSelectedSession() {
	if (!eventSource) return;
	const sessionId = sessionListState.selectedSessionId;
	if (!sessionId) return;

	try {
		const response = await fetch(`${serverUrl}/session/load`, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({sessionId}),
		});
		const data = await response.json();
		logEvent('SESSION_LOAD', data, !response.ok);
		if (!response.ok || !data?.success || !data?.session?.id) {
			addSystemMessage('加载会话失败');
			return;
		}

		currentSessionId = data.session.id;
		updateSessionStatusText();
		addSystemMessage(`已加载服务端会话: ${currentSessionId}`);

		// 渲染历史消息到聊天框
		renderSessionHistoryToChat(data.session);

		// 刷新列表（更新 updatedAt / messageCount）
		await refreshSessionList();
	} catch (error) {
		logEvent('SESSION_LOAD_ERROR', {message: error.message}, true);
	}
}

// 刷新当前会话 UI（用于回滚后自动刷新）
async function refreshCurrentSession() {
	if (!eventSource || !currentSessionId) return;

	try {
		const response = await fetch(`${serverUrl}/session/load`, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({sessionId: currentSessionId}),
		});
		const data = await response.json();
		logEvent('SESSION_REFRESH', data, !response.ok);
		if (!response.ok || !data?.success || !data?.session?.id) {
			addSystemMessage('刷新会话失败');
			return;
		}

		renderSessionHistoryToChat(data.session);
		await refreshSessionList();
	} catch (error) {
		logEvent('SESSION_REFRESH_ERROR', {message: error.message}, true);
	}
}

// 渲染历史消息到聊天框
function renderSessionHistoryToChat(session) {
	const chatBox = byId('chatBox');
	chatBox.innerHTML = '';
	removeLoadingMessage();
	clearImagePreview();

	const messages = Array.isArray(session?.messages) ? session.messages : [];
	messages.forEach(m => {
		const role = m?.role;
		if (role === 'system') {
			const text = normalizeChatMessageContent(m);
			if (text) addSystemMessage(text);
			return;
		}

		if (role === 'user') {
			const text = normalizeChatMessageContent(m);
			if (text) addMessage('user', text);
			if (Array.isArray(m?.images) && m.images.length > 0) {
				addMessage('user', '[包含图片]');
			}
			return;
		}

		if (role === 'assistant') {
			const text = normalizeChatMessageContent(m);
			if (text) addMessage('assistant', text);
			// 处理 tool_calls
			if (Array.isArray(m?.tool_calls)) {
				m.tool_calls.forEach(call => {
					const toolName = call?.function?.name || 'unknown';
					addMessage('system', `工具调用: ${toolName}`);
				});
			}
			return;
		}

		if (role === 'tool') {
			// tool 消息是工具结果，不显示
			return;
		}
	});
}

// 删除选中会话
async function deleteSelectedSession() {
	if (!eventSource) return;
	const sessionId = sessionListState.selectedSessionId;
	if (!sessionId) return;
	const confirmed = confirm(`确认删除会话 ${sessionId} ?`);
	if (!confirmed) return;

	try {
		const response = await fetch(
			`${serverUrl}/session/${encodeURIComponent(sessionId)}`,
			{
				method: 'DELETE',
			},
		);
		const data = await response.json();
		logEvent('SESSION_DELETE', data, !response.ok);
		if (data?.deleted) {
			addSystemMessage(`已删除会话: ${sessionId}`);
			if (currentSessionId === sessionId) {
				currentSessionId = null;
				updateSessionStatusText();
				byId('chatBox').innerHTML = '';
				clearImagePreview();
			}
			sessionListState.selectedSessionId = null;
			setSessionControlsEnabled(true);
			// 如果删除后当前页空了，回退一页
			if (sessionListState.page > 0 && sessionListState.sessions.length <= 1) {
				sessionListState.page -= 1;
			}
			await refreshSessionList();
		}
	} catch (error) {
		logEvent('SESSION_DELETE_ERROR', {message: error.message}, true);
	}
}

// ----------------------------------------------------------------------------
// 聊天 UI
// ----------------------------------------------------------------------------

// 添加消息到聊天框（支持 user/assistant/system）
function addMessage(role, content, imageData = null) {
	const chatBox = document.getElementById('chatBox');
	const messageDiv = document.createElement('div');
	messageDiv.className = `message ${role}`;

	if (typeof content === 'string') {
		// assistant 消息用 Markdown 渲染
		if (role === 'assistant') {
			const htmlContent = marked.parse(content);
			messageDiv.innerHTML = htmlContent;
			// 代码块语法高亮
			messageDiv.querySelectorAll('pre code').forEach(block => {
				hljs.highlightElement(block);
			});
		} else {
			messageDiv.textContent = content;
		}
	} else {
		messageDiv.innerHTML = content;
	}

	if (imageData) {
		const img = document.createElement('img');
		img.src = imageData;
		messageDiv.appendChild(img);
	}

	chatBox.appendChild(messageDiv);
	chatBox.scrollTop = chatBox.scrollHeight;
}

// 更新 assistant 消息（用于流式更新）
function updateAssistantMessage(messageDiv, content) {
	const htmlContent = marked.parse(content);
	messageDiv.innerHTML = htmlContent;
	messageDiv.querySelectorAll('pre code').forEach(block => {
		hljs.highlightElement(block);
	});
}

// 显示 loading 动画
function showLoadingMessage() {
	removeLoadingMessage();
	const chatBox = document.getElementById('chatBox');
	const loadingDiv = document.createElement('div');
	loadingDiv.className = 'message assistant loading-message';
	loadingDiv.id = 'aiLoadingMessage';
	loadingDiv.innerHTML = `
		<span class="loading-dots">
			<span></span><span></span><span></span>
		</span>
	`;
	chatBox.appendChild(loadingDiv);
	chatBox.scrollTop = chatBox.scrollHeight;
}

// 移除 loading 动画
function removeLoadingMessage() {
	const loadingMsg = document.getElementById('aiLoadingMessage');
	if (loadingMsg) {
		loadingMsg.remove();
	}
}

// 添加系统消息
function addSystemMessage(content) {
	const chatBox = document.getElementById('chatBox');
	const messageDiv = document.createElement('div');
	messageDiv.className = 'message system';
	messageDiv.textContent = content;
	chatBox.appendChild(messageDiv);
	chatBox.scrollTop = chatBox.scrollHeight;
}

// ----------------------------------------------------------------------------
// 日志
// ----------------------------------------------------------------------------

// 事件计数器
let eventCounter = 0;

// 添加事件到右侧日志面板（可展开列表）
function logEvent(type, data, isError = false) {
	const eventLog = document.getElementById('eventLog');
	const eventId = `event_${++eventCounter}`;

	const eventDiv = document.createElement('div');
	eventDiv.className = `event-item ${isError ? 'error' : 'success'}`;
	eventDiv.id = eventId;

	const timestamp = new Date().toLocaleTimeString();
	const dataPreview = getDataPreview(data);
	const hasDetails =
		data && typeof data === 'object' && Object.keys(data).length > 0;

	eventDiv.innerHTML = `
		<div class="event-header" onclick="toggleEventDetails('${eventId}')">
			<span class="event-expand">${hasDetails ? '+' : ' '}</span>
			<span class="event-timestamp">[${timestamp}]</span>
			<span class="event-type">${type}</span>
			<span class="event-preview">${escapeHtml(dataPreview)}</span>
			${
				hasDetails
					? `<span class="event-maximize" onclick="event.stopPropagation(); showLogDetail('${eventId}', '${type}', ${escapeHtml(
							JSON.stringify(JSON.stringify(data)),
					  )});" title="查看完整日志">[+]</span>`
					: ''
			}
		</div>
		${
			hasDetails
				? `
		<div class="event-details" id="${eventId}_details" style="display: none;">
			<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
		</div>
		`
				: ''
		}
	`;

	// 顺序插入：新事件追加到末尾
	eventLog.appendChild(eventDiv);
	// 自动滚动到底部
	eventLog.scrollTop = eventLog.scrollHeight;

	// 更新事件计数
	updateEventCount();
}

// 获取数据预览（简短摘要）
function getDataPreview(data) {
	if (!data) return '';
	if (typeof data === 'string')
		return data.length > 50 ? data.slice(0, 50) + '...' : data;
	if (typeof data !== 'object') return String(data);

	// 提取关键字段作为预览
	const keys = Object.keys(data);
	if (keys.length === 0) return '{}';

	const previewParts = [];
	const importantKeys = [
		'success',
		'error',
		'message',
		'sessionId',
		'id',
		'type',
		'content',
	];

	for (const key of importantKeys) {
		if (data[key] !== undefined) {
			let val = data[key];
			if (typeof val === 'string' && val.length > 30) {
				val = val.slice(0, 30) + '...';
			} else if (typeof val === 'object') {
				val = Array.isArray(val) ? `[${val.length}]` : '{...}';
			}
			previewParts.push(`${key}: ${val}`);
			if (previewParts.length >= 2) break;
		}
	}

	if (previewParts.length === 0) {
		return `{${keys.length} fields}`;
	}

	return previewParts.join(', ');
}

// 切换事件详情展开/收起
function toggleEventDetails(eventId) {
	const details = document.getElementById(`${eventId}_details`);
	const header = document.querySelector(`#${eventId} .event-expand`);

	if (!details) return;

	if (details.style.display === 'none') {
		details.style.display = 'block';
		if (header) header.textContent = '-';
	} else {
		details.style.display = 'none';
		if (header) header.textContent = '+';
	}
}

// 展开所有事件
function expandAllEvents() {
	document.querySelectorAll('.event-details').forEach(el => {
		el.style.display = 'block';
	});
	document.querySelectorAll('.event-expand').forEach(el => {
		if (el.textContent === '+') el.textContent = '-';
	});
}

// 收起所有事件
function collapseAllEvents() {
	document.querySelectorAll('.event-details').forEach(el => {
		el.style.display = 'none';
	});
	document.querySelectorAll('.event-expand').forEach(el => {
		if (el.textContent === '-') el.textContent = '+';
	});
}

// 更新事件计数显示
function updateEventCount() {
	const countEl = document.getElementById('eventCount');
	if (countEl) {
		countEl.textContent = eventCounter;
	}
}

// 清空日志
function clearLog() {
	document.getElementById('eventLog').innerHTML = '';
	eventCounter = 0;
	updateEventCount();
}

// 弹窗显示完整日志详情
function showLogDetail(eventId, type, dataJson) {
	const modal = document.getElementById('userQuestionModal');
	const title = document.getElementById('userQuestionTitle');
	const body = document.getElementById('userQuestionBody');
	const footer = document.getElementById('userQuestionFooter');

	title.textContent = `日志详情 - ${type}`;

	let jsonData = null;
	let formattedData = '';
	try {
		jsonData = JSON.parse(dataJson);
		formattedData = JSON.stringify(jsonData, null, 2);
	} catch (e) {
		formattedData = dataJson;
	}

	// 使用 JsonViewer 渲染可折叠的 JSON 树
	const jsonHtml =
		jsonData !== null
			? JsonViewer.renderTree(jsonData, {maxDepth: 3})
			: `<pre class="json-viewer"><code>${escapeHtml(
					formattedData,
			  )}</code></pre>`;

	body.innerHTML = `
		<div class="log-detail-container">
			<div class="log-detail-info">
				<span class="log-detail-label">事件ID:</span> ${escapeHtml(eventId)}
			</div>
			<div class="log-detail-info">
				<span class="log-detail-label">类型:</span> ${escapeHtml(type)}
			</div>
			<div class="log-detail-content">
				${jsonHtml}
			</div>
		</div>
	`;

	footer.innerHTML = '';

	const copyBtn = document.createElement('button');
	copyBtn.className = 'btn-secondary';
	copyBtn.textContent = '复制';
	copyBtn.onclick = () => {
		navigator.clipboard.writeText(formattedData).then(() => {
			copyBtn.textContent = '已复制';
			setTimeout(() => {
				copyBtn.textContent = '复制';
			}, 1500);
		});
	};
	footer.appendChild(copyBtn);

	const closeBtn = document.createElement('button');
	closeBtn.className = 'btn-primary';
	closeBtn.textContent = '关闭';
	closeBtn.onclick = () => {
		modal.style.display = 'none';
	};
	footer.appendChild(closeBtn);

	modal.style.display = 'flex';
}

// ----------------------------------------------------------------------------
// 会话管理
// ----------------------------------------------------------------------------

// 新建会话：清空当前 UI，并在已连接时创建服务端会话
async function newSession() {
	currentSessionId = null;
	document.getElementById('chatBox').innerHTML = '';
	clearImagePreview();
	removeLoadingMessage();
	updateSessionStatusText();

	// 未连接时，只做本地清理
	if (!eventSource) {
		addSystemMessage('已创建新会话（本地）');
		logEvent('NEW_SESSION_LOCAL', {});
		return;
	}

	try {
		const sessionId = await createServerSession();
		if (!sessionId) {
			addSystemMessage('创建服务端会话失败');
			return;
		}

		// 立即刷新会话列表，方便在右侧面板看到新会话
		sessionListState.selectedSessionId = sessionId;
		await refreshSessionList();
		setSessionControlsEnabled(true);
	} catch (error) {
		logEvent(
			'NEW_SESSION_ERROR',
			{message: error?.message || String(error)},
			true,
		);
		addSystemMessage('新建会话失败');
	}
}

// 创建服务端会话（返回 sessionId 或 null）
async function createServerSession() {
	try {
		const response = await fetch(`${serverUrl}/session/create`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({}),
		});
		const data = await response.json();
		logEvent('SESSION_CREATE', data, !response.ok);

		const sessionId = data?.session?.id;
		if (sessionId) {
			currentSessionId = sessionId;
			updateSessionStatusText();
			addSystemMessage(`已创建服务端会话: ${currentSessionId}`);
			return sessionId;
		}
		return null;
	} catch (error) {
		logEvent(
			'SESSION_CREATE_ERROR',
			{message: error?.message || String(error)},
			true,
		);
		return null;
	}
}

// 加载会话（弃用的老入口，保留兼容）
async function loadServerSession() {
	const sessionId = prompt('请输入要加载的会话ID:');
	if (!sessionId) return;
	try {
		const response = await fetch(`${serverUrl}/session/load`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({sessionId}),
		});
		const data = await response.json();
		logEvent('SESSION_LOAD', data, !response.ok);
		if (data?.session?.id) {
			currentSessionId = data.session.id;
			addSystemMessage(`已加载服务端会话: ${currentSessionId}`);
		}
	} catch (error) {
		logEvent('SESSION_LOAD_ERROR', {message: error.message}, true);
	}
}

// 列出会话（弃用的老入口，保留兼容）
async function listServerSessions() {
	const page = Number.parseInt(prompt('page (默认0):') || '0', 10) || 0;
	const pageSize =
		Number.parseInt(prompt('pageSize (默认20):') || '20', 10) || 20;
	const q = prompt('搜索关键词 q（可选）:') || '';
	const params = new URLSearchParams();
	params.set('page', String(Math.max(0, page)));
	params.set('pageSize', String(Math.max(1, pageSize)));
	if (q.trim()) params.set('q', q.trim());
	try {
		const response = await fetch(
			`${serverUrl}/session/list?${params.toString()}`,
			{
				method: 'GET',
			},
		);
		const data = await response.json();
		logEvent('SESSION_LIST', data, !response.ok);
	} catch (error) {
		logEvent('SESSION_LIST_ERROR', {message: error.message}, true);
	}
}

// 删除当前会话（弃用的老入口，保留兼容）
async function deleteCurrentSession() {
	if (!currentSessionId) {
		addSystemMessage('当前没有可删除的会话');
		return;
	}
	const confirmed = confirm(`确认删除会话 ${currentSessionId} ?`);
	if (!confirmed) return;
	try {
		const response = await fetch(
			`${serverUrl}/session/${encodeURIComponent(currentSessionId)}`,
			{method: 'DELETE'},
		);
		const data = await response.json();
		logEvent('SESSION_DELETE', data, !response.ok);
		if (data?.deleted) {
			addSystemMessage(`已删除会话: ${currentSessionId}`);
			currentSessionId = null;
		}
	} catch (error) {
		logEvent('SESSION_DELETE_ERROR', {message: error.message}, true);
	}
}

// ----------------------------------------------------------------------------
// 上下文压缩
// ----------------------------------------------------------------------------

// 压缩当前会话的上下文
async function compressCurrentSession() {
	if (!currentSessionId) {
		addSystemMessage('没有活动的会话，无法压缩');
		return;
	}

	try {
		addSystemMessage('正在压缩上下文...');
		const response = await fetch(`${serverUrl}/context/compress`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({sessionId: currentSessionId}),
		});

		const data = await response.json();
		logEvent('CONTEXT_COMPRESS', data, !response.ok);

		if (!response.ok) {
			addSystemMessage(`压缩失败: ${data?.error || 'Unknown error'}`);
			return;
		}

		if (!data?.success) {
			if (data?.hookFailed) {
				addSystemMessage(
					`压缩被 Hook 阻止: exitCode=${data?.hookErrorDetails?.exitCode}`,
				);
			} else {
				addSystemMessage(`压缩失败: ${data?.error || 'Unknown error'}`);
			}
			return;
		}

		if (data?.result === null) {
			addSystemMessage(data?.message || '无需压缩（没有历史可压缩）');
			return;
		}

		const result = data.result;
		addSystemMessage(
			`压缩成功! 摘要长度: ${result?.summary?.length || 0} 字符, ` +
				`Token 使用: ${result?.usage?.total_tokens || 0}`,
		);

		// 显示压缩摘要预览
		if (result?.summary) {
			const preview =
				result.summary.length > 500
					? result.summary.slice(0, 500) + '...'
					: result.summary;
			addMessage('system', `[压缩摘要预览]\n${preview}`);
		}
	} catch (error) {
		addSystemMessage(`压缩失败: ${error.message}`);
		logEvent('CONTEXT_COMPRESS_ERROR', {message: error.message}, true);
	}
}

// 压缩自定义消息（用于测试）
async function compressCustomMessages() {
	const messagesJson = await showCompressMessagesDialog();
	if (!messagesJson) return;

	let messages;
	try {
		messages = JSON.parse(messagesJson);
		if (!Array.isArray(messages)) {
			addSystemMessage('消息必须是数组格式');
			return;
		}
	} catch (e) {
		addSystemMessage(`JSON 解析失败: ${e.message}`);
		return;
	}

	try {
		addSystemMessage('正在压缩自定义消息...');
		const response = await fetch(`${serverUrl}/context/compress`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({messages}),
		});

		const data = await response.json();
		logEvent('CONTEXT_COMPRESS_CUSTOM', data, !response.ok);

		if (!response.ok || !data?.success) {
			addSystemMessage(`压缩失败: ${data?.error || 'Unknown error'}`);
			return;
		}

		if (data?.result === null) {
			addSystemMessage(data?.message || '无需压缩');
			return;
		}

		const result = data.result;
		addSystemMessage(
			`压缩成功! 摘要长度: ${result?.summary?.length || 0} 字符`,
		);

		if (result?.summary) {
			addMessage('system', `[压缩摘要]\n${result.summary}`);
		}
	} catch (error) {
		addSystemMessage(`压缩失败: ${error.message}`);
		logEvent('CONTEXT_COMPRESS_ERROR', {message: error.message}, true);
	}
}

// 显示压缩消息输入对话框
function showCompressMessagesDialog() {
	return new Promise(resolve => {
		const modal = document.getElementById('userQuestionModal');
		const title = document.getElementById('userQuestionTitle');
		const body = document.getElementById('userQuestionBody');
		const footer = document.getElementById('userQuestionFooter');

		title.textContent = '压缩自定义消息';

		const defaultMessages = JSON.stringify(
			[
				{role: 'user', content: 'Hello, how are you?'},
				{role: 'assistant', content: 'I am doing well, thank you for asking!'},
				{role: 'user', content: 'Can you help me with coding?'},
				{
					role: 'assistant',
					content: 'Of course! I would be happy to help you with coding.',
				},
			],
			null,
			2,
		);

		body.innerHTML = `
			<div class="compress-dialog">
				<p style="margin-bottom: 12px; color: #666; font-size: 13px;">
					输入要压缩的消息数组 (JSON 格式)，每条消息需包含 role 和 content 字段。
				</p>
				<textarea 
					id="compressMessagesInput" 
					style="width: 100%; height: 280px; font-family: monospace; font-size: 12px; padding: 10px; border: 1px solid #444; border-radius: 4px; background: #1e1e1e; color: #d4d4d4; resize: vertical;"
					spellcheck="false"
				>${defaultMessages}</textarea>
				<div style="margin-top: 8px; font-size: 12px; color: #888;">
					提示: role 可以是 "user"、"assistant" 或 "system"
				</div>
			</div>
		`;

		footer.innerHTML = '';

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'btn-secondary';
		cancelBtn.textContent = '取消';
		cancelBtn.onclick = () => {
			modal.style.display = 'none';
			resolve(null);
		};
		footer.appendChild(cancelBtn);

		const confirmBtn = document.createElement('button');
		confirmBtn.className = 'btn-primary';
		confirmBtn.textContent = '压缩';
		confirmBtn.onclick = () => {
			const input = document
				.getElementById('compressMessagesInput')
				.value.trim();
			modal.style.display = 'none';
			resolve(input || null);
		};
		footer.appendChild(confirmBtn);

		modal.style.display = 'flex';

		// 自动聚焦到输入框
		setTimeout(() => {
			const textarea = document.getElementById('compressMessagesInput');
			if (textarea) textarea.focus();
		}, 100);
	});
}

// 更新顶部状态文本
function updateSessionStatusText() {
	const statusEl = byId('status');
	if (!eventSource) {
		statusEl.textContent = '未连接';
		return;
	}
	if (currentSessionId) {
		statusEl.textContent = `已连接 (Session: ${currentSessionId.substring(
			0,
			8,
		)}...)`;
	} else {
		statusEl.textContent = '已连接';
	}
}

// ----------------------------------------------------------------------------
// SSE 连接管理
// ----------------------------------------------------------------------------

// 更新连接状态（按钮启用/禁用）
function updateStatus(connected) {
	const statusEl = document.getElementById('status');
	statusEl.textContent = connected ? '已连接' : '未连接';
	statusEl.className = `status ${connected ? 'connected' : 'disconnected'}`;

	document.getElementById('connectBtn').disabled = connected;
	document.getElementById('disconnectBtn').disabled = !connected;
	document.getElementById('sendBtn').disabled = !connected;
	document.getElementById('rollbackBtn').disabled = !connected;
}

// 连接到 SSE 服务器
function connect() {
	serverUrl = document.getElementById('serverUrl').value;

	eventSource = new EventSource(`${serverUrl}/events`);

	eventSource.onopen = () => {
		updateStatus(true);
		updateSessionStatusText();
		addSystemMessage('已连接到 Snow AI');
		logEvent('CONNECTED', {serverUrl});

		// 启用会话列表面板
		byId('refreshSessionsBtn').disabled = false;
		setSessionControlsEnabled(true);
		// 同步 UI 控件值
		byId('sessionPageSize').value = String(sessionListState.pageSize);
		byId('sessionSearchInput').value = sessionListState.q;
		renderSessionList();
		void refreshSessionList();
	};

	eventSource.onerror = error => {
		updateStatus(false);
		updateSessionStatusText();
		addSystemMessage('连接错误');
		logEvent('ERROR', {message: '连接失败'}, true);

		// 禁用会话列表面板
		setSessionControlsEnabled(false);

		eventSource.close();
		eventSource = null;
	};

	eventSource.onmessage = event => {
		const data = JSON.parse(event.data);
		handleEvent(data);
	};
}

// 断开连接
function disconnect() {
	if (eventSource) {
		eventSource.close();
		eventSource = null;
		updateStatus(false);
		updateSessionStatusText();
		addSystemMessage('已断开连接');
		logEvent('DISCONNECTED', {});
	}

	// 禁用会话列表面板
	setSessionControlsEnabled(false);
}

// ----------------------------------------------------------------------------
// SSE 事件处理
// ----------------------------------------------------------------------------

// 处理从服务端推送的各类事件
function handleEvent(event) {
	logEvent(event.type, event.data);

	switch (event.type) {
		case 'connected':
			addSystemMessage(`连接ID: ${event.data.connectionId}`);
			break;

		case 'rollback_result':
			addSystemMessage(
				event.data?.success
					? `回滚成功: messageIndex=${event.data?.messageIndex}，回滚文件数=${
							event.data?.filesRolledBack ?? 0
					  }`
					: `回滚失败: ${event.data?.error || 'Unknown error'}`,
			);
			// 回滚完成后允许继续操作
			document.getElementById('rollbackBtn').disabled = false;
			// 回滚后自动刷新会话 UI
			if (event.data?.success && currentSessionId) {
				void refreshCurrentSession();
			}
			break;

		case 'message':
			// 捕获 sessionId（首次收到 system 消息时）
			if (event.data.role === 'system' && event.data.sessionId) {
				currentSessionId = event.data.sessionId;
				addSystemMessage(`会话ID: ${currentSessionId}`);
				const statusEl = document.getElementById('status');
				statusEl.textContent = `已连接 (Session: ${currentSessionId.substring(
					0,
					8,
				)}...)`;
				logEvent('SESSION_ID', {sessionId: currentSessionId});
				break;
			}

			if (event.data.streaming) {
				// 流式消息 - 更新最后一条消息，但保持 loading
				const chatBox = document.getElementById('chatBox');
				const messages = Array.from(chatBox.children);

				// 查找最后一个 assistant 消息（跳过 loading）
				let lastAssistantMsg = null;
				for (let i = messages.length - 1; i >= 0; i--) {
					if (
						messages[i].classList.contains('assistant') &&
						!messages[i].classList.contains('loading-message')
					) {
						lastAssistantMsg = messages[i];
						break;
					}
				}

				if (lastAssistantMsg) {
					// 更新已存在的助手消息
					updateAssistantMessage(lastAssistantMsg, event.data.content);
				} else {
					// 创建新的助手消息（在 loading 之前插入）
					const loadingMsg = document.getElementById('aiLoadingMessage');
					const newMessage = document.createElement('div');
					newMessage.className = 'message assistant';
					const htmlContent = marked.parse(event.data.content);
					newMessage.innerHTML = htmlContent;
					newMessage.querySelectorAll('pre code').forEach(block => {
						hljs.highlightElement(block);
					});

					if (loadingMsg) {
						chatBox.insertBefore(newMessage, loadingMsg);
					} else {
						chatBox.appendChild(newMessage);
					}
				}
				chatBox.scrollTop = chatBox.scrollHeight;
			} else if (event.data.role === 'user') {
				// 用户消息：显示并立刻开始 loading
				addMessage('user', event.data.content);
				showLoadingMessage();
				document.getElementById('abortBtn').disabled = false;
			} else if (event.data.role === 'assistant') {
				// 非流式 assistant 消息
				const chatBox = document.getElementById('chatBox');
				const loadingMsg = document.getElementById('aiLoadingMessage');
				const newMessage = document.createElement('div');
				newMessage.className = 'message assistant';
				const htmlContent = marked.parse(event.data.content);
				newMessage.innerHTML = htmlContent;
				newMessage.querySelectorAll('pre code').forEach(block => {
					hljs.highlightElement(block);
				});

				if (loadingMsg) {
					chatBox.insertBefore(newMessage, loadingMsg);
				} else {
					chatBox.appendChild(newMessage);
				}
				chatBox.scrollTop = chatBox.scrollHeight;
			}
			break;

		case 'tool_call':
			const toolName =
				event.data?.name || event.data?.function?.name || 'unknown';
			addSystemMessage(`工具调用: ${toolName}`);
			break;

		case 'tool_result':
			// 工具结果不显示在聊天框
			break;

		case 'tool_confirmation_request':
			handleToolConfirmation(event);
			break;

		case 'user_question_request':
			handleUserQuestion(event);
			break;

		case 'complete':
			// 对话完成
			removeLoadingMessage();
			addSystemMessage('对话完成');
			if (event.data.sessionId) {
				currentSessionId = event.data.sessionId;
				logEvent('SESSION_SAVED', {sessionId: currentSessionId});
			}
			document.getElementById('abortBtn').disabled = true;
			break;

		case 'error':
			// 错误
			removeLoadingMessage();
			addSystemMessage(`错误: ${event.data.message}`);
			document.getElementById('abortBtn').disabled = true;
			break;
	}
}

// 处理工具确认请求（弹出对话框）
function handleToolConfirmation(event) {
	showToolConfirmationDialog(event, sendResponse);
}

// 处理用户问题请求（弹出对话框）
function handleUserQuestion(event) {
	showUserQuestionDialog(event, sendResponse);
}

// ----------------------------------------------------------------------------
// 发送消息
// ----------------------------------------------------------------------------

// 发送用户消息到服务端
async function sendMessage() {
	const input = document.getElementById('messageInput');
	const content = input.value.trim();
	const hasImages = Array.isArray(selectedImages) && selectedImages.length > 0;

	if (!content && !hasImages) return;

	// 立即清空输入框
	input.value = '';
	const imagesForSend = Array.isArray(selectedImages)
		? selectedImages.slice()
		: [];
	clearImagePreview();

	try {
		const payload = {
			type: 'chat',
			content: content || (hasImages ? '查看图片' : ''),
		};

		if (currentSessionId) {
			payload.sessionId = currentSessionId;
		}

		const yoloMode = document.getElementById('yoloModeCheckbox').checked;
		if (yoloMode) {
			payload.yoloMode = true;
		}

		if (hasImages) {
			const images = [];
			for (const dataUri of imagesForSend) {
				const base64Match = String(dataUri).match(/^data:([^;]+);base64,(.+)$/);
				if (!base64Match) continue;
				images.push({
					data: dataUri,
					mimeType: base64Match[1],
				});
			}
			if (images.length > 0) {
				payload.images = images;
			}
		}

		const response = await fetch(`${serverUrl}/message`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		});

		await response.json();
		logEvent('MESSAGE_SENT', {
			content,
			imageCount: imagesForSend.length,
			yoloMode,
		});
	} catch (error) {
		removeLoadingMessage();
		addSystemMessage(`发送失败: ${error.message}`);
		logEvent('SEND_ERROR', {message: error.message}, true);
	}
}

// 终止当前任务
async function abortTask() {
	if (!currentSessionId) {
		addSystemMessage('没有活动的会话');
		return;
	}

	try {
		const payload = {
			type: 'abort',
			sessionId: currentSessionId,
		};

		const response = await fetch(`${serverUrl}/message`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		});

		await response.json();
		logEvent('ABORT_SENT', {sessionId: currentSessionId});

		// 移除 loading 并禁用终止按钮
		removeLoadingMessage();
		document.getElementById('abortBtn').disabled = true;
		document.getElementById('rollbackBtn').disabled = true;
		addSystemMessage('任务已终止');
	} catch (error) {
		removeLoadingMessage();
		addSystemMessage(`终止失败: ${error.message}`);
		logEvent('ABORT_ERROR', {message: error.message}, true);
		document.getElementById('abortBtn').disabled = true;
		document.getElementById('rollbackBtn').disabled = true;
	}
}

// ----------------------------------------------------------------------------
// 回滚 UI
// ----------------------------------------------------------------------------

async function fetchRollbackPoints(sessionId) {
	const params = new URLSearchParams();
	params.set('sessionId', sessionId);
	const response = await fetch(
		`${serverUrl}/session/rollback-points?${params.toString()}`,
	);
	const data = await response.json();
	logEvent('ROLLBACK_POINTS', data, !response.ok);
	if (!response.ok || !data?.success) {
		throw new Error(data?.error || '加载回滚点失败');
	}
	return Array.isArray(data.points) ? data.points : [];
}

function buildRollbackPointsHtml(points) {
	if (!points || points.length === 0) {
		return '<div style="color:#666;font-size:13px;">该会话暂无可回滚点（没有 user 消息）。</div>';
	}

	let html = '';
	html += '<div class="rollback-list">';
	points.forEach((p, idx) => {
		const messageIndex =
			typeof p?.messageIndex === 'number' ? p.messageIndex : -1;
		const summary = p?.summary ? String(p.summary) : '';
		const timeText = formatTime(p?.timestamp);
		const hasSnapshot = !!p?.hasSnapshot;
		const filesToRollbackCount =
			typeof p?.filesToRollbackCount === 'number' ? p.filesToRollbackCount : 0;

		const snapLabel = hasSnapshot
			? `有快照 · 可回滚文件: ${filesToRollbackCount}`
			: '无快照';

		html += `
			<div class="rollback-item" onclick="this.querySelector('input').click(); event.stopPropagation();">
				<input type="radio" name="rollbackPoint" id="rb_${idx}" value="${escapeHtml(
			String(messageIndex),
		)}">
				<label for="rb_${idx}">
					<div class="rollback-row1">
						<div class="rollback-title">messageIndex: ${escapeHtml(
							String(messageIndex),
						)}</div>
						<div class="rollback-time">${escapeHtml(timeText)}</div>
					</div>
					<div class="rollback-row2">${escapeHtml(summarizeText(summary))}</div>
					<div class="rollback-row3">${escapeHtml(snapLabel)}</div>
				</label>
			</div>
		`;
	});
	html += '</div>';

	html += `
		<div class="checkbox-option" style="margin-top: 12px;">
			<input type="checkbox" id="rollbackFilesCheckbox" checked />
			<label for="rollbackFilesCheckbox">同时回滚文件快照（若所选点无快照，将跳过文件回滚）</label>
		</div>
	`;

	html += `
		<div class="rollback-hint">
			提示：这里只列出 role=user 的消息索引（与服务端 session.messages 一致）。
		</div>
	`;

	return html;
}

async function showRollbackDialogAndGetSelection(sessionId) {
	const modal = document.getElementById('userQuestionModal');
	const title = document.getElementById('userQuestionTitle');
	const body = document.getElementById('userQuestionBody');
	const footer = document.getElementById('userQuestionFooter');

	title.textContent = '选择回滚点';
	body.innerHTML = '<div style="color:#666;font-size:13px;">加载中...</div>';
	footer.innerHTML = '';
	modal.style.display = 'flex';

	let points = [];
	try {
		points = await fetchRollbackPoints(sessionId);
	} catch (err) {
		body.innerHTML = `<div style="color:#c82333;font-size:13px;">${escapeHtml(
			err?.message || String(err),
		)}</div>`;
	}

	body.innerHTML = buildRollbackPointsHtml(points);

	return await new Promise(resolve => {
		footer.innerHTML = '';

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'btn-secondary';
		cancelBtn.textContent = '取消';
		cancelBtn.onclick = () => {
			modal.style.display = 'none';
			resolve({cancelled: true});
		};
		footer.appendChild(cancelBtn);

		const confirmBtn = document.createElement('button');
		confirmBtn.className = 'btn-primary';
		confirmBtn.textContent = '回滚';
		confirmBtn.onclick = () => {
			const selected = document.querySelector(
				'input[name="rollbackPoint"]:checked',
			);
			if (!selected) {
				resolve({cancelled: true});
				modal.style.display = 'none';
				addSystemMessage('未选择回滚点');
				return;
			}
			const messageIndex = Number.parseInt(selected.value, 10);
			const rollbackFiles = !!document.getElementById('rollbackFilesCheckbox')
				.checked;
			modal.style.display = 'none';
			resolve({cancelled: false, messageIndex, rollbackFiles});
		};
		footer.appendChild(confirmBtn);

		// 点击单选项时高亮（复用现有 selected 样式）
		document.querySelectorAll('.rollback-item').forEach(item => {
			item.addEventListener('click', function () {
				document
					.querySelectorAll('.rollback-item')
					.forEach(i => i.classList.remove('selected'));
				this.classList.add('selected');
			});
		});
	});
}

// 回滚当前会话（弹窗选择回滚点）
async function rollbackSession() {
	if (!currentSessionId) {
		addSystemMessage('没有活动的会话');
		return;
	}

	let selection;
	try {
		selection = await showRollbackDialogAndGetSelection(currentSessionId);
	} catch (error) {
		addSystemMessage(`打开回滚弹窗失败: ${error.message}`);
		logEvent('ROLLBACK_DIALOG_ERROR', {message: error.message}, true);
		return;
	}

	if (!selection || selection.cancelled) return;
	const {messageIndex, rollbackFiles} = selection;
	if (!Number.isFinite(messageIndex) || messageIndex < 0) {
		addSystemMessage('messageIndex 非法');
		return;
	}

	try {
		document.getElementById('rollbackBtn').disabled = true;

		const payload = {
			type: 'rollback',
			sessionId: currentSessionId,
			rollback: {
				messageIndex,
				rollbackFiles,
			},
		};

		const response = await fetch(`${serverUrl}/message`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		});

		const data = await response.json();
		logEvent('ROLLBACK_SENT', {
			sessionId: currentSessionId,
			messageIndex,
			rollbackFiles,
		});

		if (!response.ok || !data?.success) {
			addSystemMessage('回滚请求发送失败');
			return;
		}

		addSystemMessage('已发送回滚请求，等待 SSE 返回 rollback_result 事件');
	} catch (error) {
		addSystemMessage(`回滚失败: ${error.message}`);
		logEvent('ROLLBACK_ERROR', {message: error.message}, true);
	} finally {
		document.getElementById('rollbackBtn').disabled = false;
	}
}

// 发送响应（工具确认/用户问题的回复）
async function sendResponse(type, requestId, response) {
	try {
		const res = await fetch(`${serverUrl}/message`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				type: type,
				requestId: requestId,
				response: response,
			}),
		});

		const data = await res.json();
		logEvent('RESPONSE_SENT', {type, requestId});
	} catch (error) {
		logEvent('SEND_ERROR', {message: error.message}, true);
	}
}

// ----------------------------------------------------------------------------
// 图片处理
// ----------------------------------------------------------------------------

// 处理用户选择的图片
function handleImageSelect(filesOrFile) {
	const files = Array.isArray(filesOrFile)
		? filesOrFile
		: filesOrFile
		? [filesOrFile]
		: [];
	if (!files.length) return;

	for (const file of files) {
		if (!file || !file.type || !String(file.type).startsWith('image/')) {
			addSystemMessage('请选择图片文件');
			continue;
		}

		const reader = new FileReader();
		reader.onload = e => {
			const dataUri = e.target.result;
			if (typeof dataUri === 'string') {
				selectedImages.push(dataUri);
				showImagePreview(selectedImages);
			}
		};
		reader.readAsDataURL(file);
	}
}

// 显示图片预览
function showImagePreview(images) {
	const preview = document.getElementById('imagePreview');
	const imgs = Array.isArray(images) ? images : images ? [images] : [];
	preview.className =
		imgs.length > 0 ? 'image-preview active' : 'image-preview';

	if (imgs.length === 0) {
		preview.innerHTML = '';
		return;
	}

	preview.innerHTML = `
		<div class="image-preview-toolbar">
			<div>已选择 ${imgs.length} 张</div>
			<button class="remove-image" onclick="clearImagePreview()">清空</button>
		</div>
		<div class="image-preview-grid">
			${imgs
				.map(
					(src, idx) => `
						<div class="image-preview-item">
							<img src="${src}" alt="预览图片 ${idx + 1}" />
							<button class="remove-image" onclick="removeSelectedImage(${idx})">移除</button>
						</div>
					`,
				)
				.join('')}
		</div>
		`;
}

// 清除图片预览
function removeSelectedImage(index) {
	if (!Array.isArray(selectedImages)) selectedImages = [];
	selectedImages.splice(index, 1);
	showImagePreview(selectedImages);
	// 只有在清空后才重置 input，避免用户连续追加选择时丢失状态
	if (selectedImages.length === 0) {
		document.getElementById('imageInput').value = '';
	}
}

function clearImagePreview() {
	const preview = document.getElementById('imagePreview');
	preview.className = 'image-preview';
	preview.innerHTML = '';
	selectedImages = [];
	document.getElementById('imageInput').value = '';
}

// ----------------------------------------------------------------------------
// 页面初始化
// ----------------------------------------------------------------------------

window.addEventListener('load', () => {
	updateStatus(false);

	// 图片上传事件（支持多选）
	const imageInput = document.getElementById('imageInput');
	imageInput.addEventListener('change', e => {
		const files = Array.from(e.target.files || []);
		if (files.length > 0) {
			handleImageSelect(files);
		}
	});

	// 粘贴图片支持（支持多张）
	const messageInput = document.getElementById('messageInput');
	messageInput.addEventListener('paste', e => {
		const items = Array.from(e.clipboardData?.items || []);
		const imageFiles = [];
		for (const item of items) {
			if (String(item.type || '').indexOf('image') !== -1) {
				const file = item.getAsFile();
				if (file) imageFiles.push(file);
			}
		}
		if (imageFiles.length > 0) {
			handleImageSelect(imageFiles);
			e.preventDefault();
		}
	});
});
