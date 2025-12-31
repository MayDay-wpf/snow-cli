// 工具确认对话框
function showToolConfirmationDialog(event, sendResponse) {
	const modal = document.getElementById('toolConfirmationModal');
	const body = document.getElementById('toolConfirmationBody');
	const footer = document.getElementById('toolConfirmationFooter');

	const {
		toolCall,
		batchToolNames,
		isSensitive,
		sensitiveInfo,
		availableOptions,
	} = event.data;

	let html = '';

	// 敏感警告
	if (isSensitive && sensitiveInfo) {
		html += `
			<div class="sensitive-warning">
				<h4>敏感命令警告</h4>
				<p><strong>模式:</strong> ${sensitiveInfo.pattern}</p>
				<p><strong>说明:</strong> ${sensitiveInfo.description}</p>
			</div>
		`;
	}

	// 工具信息
	html += '<div class="tool-info">';
	html += `<div class="tool-info-item">`;
	html += `<div class="tool-info-label">工具名称</div>`;
	html += `<div class="tool-info-value">${toolCall.function.name}</div>`;
	html += `</div>`;

	// 参数
	if (toolCall.function.arguments) {
		html += `<div class="tool-info-item">`;
		html += `<div class="tool-info-label">参数</div>`;
		html += `<div class="tool-args">${JSON.stringify(
			JSON.parse(toolCall.function.arguments),
			null,
			2,
		)}</div>`;
		html += `</div>`;
	}

	// 批量工具
	if (batchToolNames) {
		html += `<div class="tool-info-item">`;
		html += `<div class="tool-info-label">批量工具</div>`;
		html += `<div class="tool-info-value">${batchToolNames}</div>`;
		html += `</div>`;
	}

	html += '</div>';

	body.innerHTML = html;

	// 创建按钮
	footer.innerHTML = '';
	availableOptions.forEach(option => {
		const btn = document.createElement('button');
		btn.className =
			option.value === 'approve'
				? 'btn-success'
				: option.value === 'approve_always'
				? 'btn-primary'
				: option.value === 'reject'
				? 'btn-danger'
				: 'btn-secondary';
		btn.textContent = option.label;
		btn.onclick = async () => {
			modal.style.display = 'none';
			if (option.value === 'reject_with_reply') {
				// 显示输入框
				const replyText = prompt('请输入拒绝理由:');
				if (replyText) {
					await sendResponse('tool_confirmation_response', event.requestId, {
						rejectWithReply: replyText,
					});
				} else {
					await sendResponse(
						'tool_confirmation_response',
						event.requestId,
						'reject',
					);
				}
			} else {
				await sendResponse(
					'tool_confirmation_response',
					event.requestId,
					option.value,
				);
			}
		};
		footer.appendChild(btn);
	});

	modal.style.display = 'flex';
}

// 用户问题对话框
function showUserQuestionDialog(event, sendResponse) {
	const modal = document.getElementById('userQuestionModal');
	const title = document.getElementById('userQuestionTitle');
	const body = document.getElementById('userQuestionBody');
	const footer = document.getElementById('userQuestionFooter');

	const {question, options, multiSelect} = event.data;

	title.textContent = question;

	let html = '';

	// 选项列表
	if (options && options.length > 0) {
		html += '<div class="question-options">';
		options.forEach((option, index) => {
			const inputType = multiSelect ? 'checkbox' : 'radio';
			const inputId = `option_${index}`;
			html += `
				<div class="option-item" onclick="this.querySelector('input').click(); event.stopPropagation();">
					<input type="${inputType}" name="userOption" id="${inputId}" value="${option}">
					<label for="${inputId}">${option}</label>
				</div>
			`;
		});
		html += '</div>';
	}

	// 自定义输入
	html += `
		<div class="custom-input-section">
			<label for="customInput">或输入自定义内容:</label>
			<textarea id="customInput" placeholder="在此输入自定义内容..."></textarea>
		</div>
	`;

	body.innerHTML = html;

	// 按钮
	footer.innerHTML = '';

	const cancelBtn = document.createElement('button');
	cancelBtn.className = 'btn-secondary';
	cancelBtn.textContent = '取消';
	cancelBtn.onclick = async () => {
		modal.style.display = 'none';
		await sendResponse('user_question_response', event.requestId, {
			selected: '',
			cancelled: true,
		});
	};
	footer.appendChild(cancelBtn);

	const confirmBtn = document.createElement('button');
	confirmBtn.className = 'btn-primary';
	confirmBtn.textContent = '确定';
	confirmBtn.onclick = async () => {
		modal.style.display = 'none';

		const customInput = document.getElementById('customInput').value.trim();

		if (customInput) {
			// 有自定义输入
			await sendResponse('user_question_response', event.requestId, {
				selected: multiSelect ? [customInput] : customInput,
				customInput,
			});
		} else {
			// 使用选项
			if (multiSelect) {
				const selected = Array.from(
					document.querySelectorAll('input[name="userOption"]:checked'),
				).map(input => input.value);
				await sendResponse('user_question_response', event.requestId, {
					selected: selected.length > 0 ? selected : '',
				});
			} else {
				const selectedInput = document.querySelector(
					'input[name="userOption"]:checked',
				);
				await sendResponse('user_question_response', event.requestId, {
					selected: selectedInput ? selectedInput.value : '',
				});
			}
		}
	};
	footer.appendChild(confirmBtn);

	modal.style.display = 'flex';

	// 点击选项时高亮
	document.querySelectorAll('.option-item').forEach(item => {
		item.addEventListener('click', function () {
			const input = this.querySelector('input');
			if (input.type === 'radio') {
				document
					.querySelectorAll('.option-item')
					.forEach(i => i.classList.remove('selected'));
			}
			if (input.checked) {
				this.classList.add('selected');
			} else {
				this.classList.remove('selected');
			}
		});
	});
}
