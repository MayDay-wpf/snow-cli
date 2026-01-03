// ============================================================================
// JSON Viewer - 基于 highlight.js 的 JSON 高亮显示器
// ============================================================================

/**
 * JSON 高亮显示器
 * 使用 highlight.js 进行语法高亮，支持缩进和折叠
 */
const JsonViewer = {
	/**
	 * 将 JSON 数据渲染为高亮 HTML
	 * @param {any} data - JSON 数据（对象、数组或字符串）
	 * @param {object} options - 配置选项
	 * @param {number} options.indent - 缩进空格数，默认 2
	 * @param {boolean} options.highlight - 是否启用高亮，默认 true
	 * @returns {string} 渲染后的 HTML 字符串
	 */
	render(data, options = {}) {
		const {indent = 2, highlight = true} = options;

		let jsonString = '';
		if (typeof data === 'string') {
			try {
				// 尝试解析并重新格式化
				const parsed = JSON.parse(data);
				jsonString = JSON.stringify(parsed, null, indent);
			} catch (e) {
				// 解析失败，直接使用原字符串
				jsonString = data;
			}
		} else {
			jsonString = JSON.stringify(data, null, indent);
		}

		if (!highlight || typeof hljs === 'undefined') {
			return `<pre class="json-viewer"><code>${this.escapeHtml(
				jsonString,
			)}</code></pre>`;
		}

		// 使用 highlight.js 进行高亮
		const highlighted = hljs.highlight(jsonString, {language: 'json'});
		return `<pre class="json-viewer"><code class="hljs language-json">${highlighted.value}</code></pre>`;
	},

	/**
	 * 将 JSON 数据渲染到指定容器
	 * @param {HTMLElement|string} container - 容器元素或选择器
	 * @param {any} data - JSON 数据
	 * @param {object} options - 配置选项
	 */
	renderTo(container, data, options = {}) {
		const el =
			typeof container === 'string'
				? document.querySelector(container)
				: container;

		if (!el) {
			console.error('JsonViewer: 容器元素不存在');
			return;
		}

		el.innerHTML = this.render(data, options);
	},

	/**
	 * 创建可折叠的 JSON 树视图
	 * @param {any} data - JSON 数据
	 * @param {object} options - 配置选项
	 * @param {number} options.maxDepth - 默认展开深度，默认 2
	 * @returns {string} 渲染后的 HTML 字符串
	 */
	renderTree(data, options = {}) {
		const {maxDepth = 2} = options;

		let jsonData = data;
		if (typeof data === 'string') {
			try {
				jsonData = JSON.parse(data);
			} catch (e) {
				return `<pre class="json-viewer"><code>${this.escapeHtml(
					data,
				)}</code></pre>`;
			}
		}

		return `<div class="json-tree">${this._buildTree(
			jsonData,
			0,
			maxDepth,
		)}</div>`;
	},

	/**
	 * 递归构建 JSON 树
	 * @private
	 */
	_buildTree(data, depth, maxDepth) {
		if (data === null) {
			return '<span class="json-null">null</span>';
		}

		if (typeof data === 'boolean') {
			return `<span class="json-boolean">${data}</span>`;
		}

		if (typeof data === 'number') {
			return `<span class="json-number">${data}</span>`;
		}

		if (typeof data === 'string') {
			const escaped = this.escapeHtml(data);
			// 长字符串截断显示
			if (data.length > 100) {
				const preview = this.escapeHtml(data.slice(0, 100));
				return `<span class="json-string" title="${escaped}">"${preview}..."</span>`;
			}
			return `<span class="json-string">"${escaped}"</span>`;
		}

		if (Array.isArray(data)) {
			if (data.length === 0) {
				return '<span class="json-bracket">[]</span>';
			}

			const collapsed = depth >= maxDepth;
			const id = this._generateId();

			let html = `<span class="json-toggle ${
				collapsed ? 'collapsed' : ''
			}" data-target="${id}">${collapsed ? '+' : '-'}</span>`;
			html += '<span class="json-bracket">[</span>';
			html += `<span class="json-size">${data.length} items</span>`;
			html += `<div class="json-content" id="${id}" style="display: ${
				collapsed ? 'none' : 'block'
			}">`;

			data.forEach((item, index) => {
				html += '<div class="json-item">';
				html += `<span class="json-index">${index}:</span> `;
				html += this._buildTree(item, depth + 1, maxDepth);
				if (index < data.length - 1)
					html += '<span class="json-comma">,</span>';
				html += '</div>';
			});

			html += '</div>';
			html += '<span class="json-bracket">]</span>';
			return html;
		}

		if (typeof data === 'object') {
			const keys = Object.keys(data);
			if (keys.length === 0) {
				return '<span class="json-bracket">{}</span>';
			}

			const collapsed = depth >= maxDepth;
			const id = this._generateId();

			let html = `<span class="json-toggle ${
				collapsed ? 'collapsed' : ''
			}" data-target="${id}">${collapsed ? '+' : '-'}</span>`;
			html += '<span class="json-bracket">{</span>';
			html += `<span class="json-size">${keys.length} keys</span>`;
			html += `<div class="json-content" id="${id}" style="display: ${
				collapsed ? 'none' : 'block'
			}">`;

			keys.forEach((key, index) => {
				html += '<div class="json-item">';
				html += `<span class="json-key">"${this.escapeHtml(key)}"</span>`;
				html += '<span class="json-colon">: </span>';
				html += this._buildTree(data[key], depth + 1, maxDepth);
				if (index < keys.length - 1)
					html += '<span class="json-comma">,</span>';
				html += '</div>';
			});

			html += '</div>';
			html += '<span class="json-bracket">}</span>';
			return html;
		}

		return `<span>${this.escapeHtml(String(data))}</span>`;
	},

	/**
	 * 切换折叠状态
	 * @param {string} id - 内容元素 ID
	 */
	toggle(id) {
		const content = document.getElementById(id);
		if (!content) return;

		// 向前查找 json-toggle 元素（跳过 json-size 和 json-bracket）
		let toggle = content.previousElementSibling;
		while (toggle && !toggle.classList.contains('json-toggle')) {
			toggle = toggle.previousElementSibling;
		}
		if (!toggle) return;

		if (content.style.display === 'none') {
			content.style.display = 'block';
			toggle.textContent = '-';
			toggle.classList.remove('collapsed');
		} else {
			content.style.display = 'none';
			toggle.textContent = '+';
			toggle.classList.add('collapsed');
		}
	},

	/**
	 * 展开所有节点
	 * @param {HTMLElement|string} container - 容器元素或选择器
	 */
	expandAll(container) {
		const el =
			typeof container === 'string'
				? document.querySelector(container)
				: container;
		if (!el) return;

		el.querySelectorAll('.json-content').forEach(content => {
			content.style.display = 'block';
		});
		el.querySelectorAll('.json-toggle').forEach(toggle => {
			toggle.textContent = '-';
			toggle.classList.remove('collapsed');
		});
	},

	/**
	 * 折叠所有节点
	 * @param {HTMLElement|string} container - 容器元素或选择器
	 */
	collapseAll(container) {
		const el =
			typeof container === 'string'
				? document.querySelector(container)
				: container;
		if (!el) return;

		el.querySelectorAll('.json-content').forEach(content => {
			content.style.display = 'none';
		});
		el.querySelectorAll('.json-toggle').forEach(toggle => {
			toggle.textContent = '+';
			toggle.classList.add('collapsed');
		});
	},

	/**
	 * 生成唯一 ID
	 * @private
	 */
	_idCounter: 0,
	_generateId() {
		return `json_node_${++this._idCounter}`;
	},

	/**
	 * HTML 转义
	 * @param {string} str - 原始字符串
	 * @returns {string} 转义后的字符串
	 */
	escapeHtml(str) {
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	},
};

// 导出到全局
window.JsonViewer = JsonViewer;

// 使用事件委托处理折叠点击
document.addEventListener('click', function (e) {
	const toggle = e.target.closest('.json-toggle');
	if (!toggle) return;

	const targetId = toggle.getAttribute('data-target');
	if (targetId) {
		e.preventDefault();
		e.stopPropagation();
		JsonViewer.toggle(targetId);
	}
});
