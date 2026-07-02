import type {HandlerContext} from '../../types.js';

export function filePickerHandler(ctx: HandlerContext): boolean {
	const {input, key, options} = ctx;
	const {
		showFilePicker,
		filteredFileCount,
		fileSelectedIndex,
		setFileSelectedIndex,
		fileListRef,
		handleFileSelect,
		handleMultipleFileSelect,
	} = options;

	if (!showFilePicker) return false;

	// Up arrow in file picker - 循环导航:第一项 → 最后一项
	if (key.upArrow) {
		setFileSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, filteredFileCount - 1),
		);
		return true;
	}

	// Down arrow in file picker
	// 便捷深度检索：只要光标已停在最后一项（无论有多少结果），且还有未扫描的深层目录，
	// 再按 ⬇️ 就把扫描深度加深一层，避免被表层结果误以为已经搜索完毕。
	// 触发不成功（已扫到底 / 仍在扫描中）时，回退为原有的循环导航行为。
	if (key.downArrow) {
		const maxIndex = Math.max(0, filteredFileCount - 1);
		if (
			filteredFileCount > 0 &&
			fileSelectedIndex >= maxIndex &&
			fileListRef.current?.triggerDeeperSearch?.()
		) {
			return true;
		}
		setFileSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Space - toggle multi-select checkbox on the current item. We deliberately
	// only intercept a literal " " here (not Ctrl/Meta-space, not IME commits
	// that happen to start with a space) so the file query input box can still
	// receive normal spaces when the user is just typing.
	if (input === ' ' && !key.ctrl && !key.meta && !key.shift) {
		// toggleSelection returns false for unsupported items (e.g. directories
		// in file-search mode). In that case, fall through so the space still
		// reaches the query input as a regular character.
		if (fileListRef.current?.toggleSelection?.()) {
			return true;
		}
		return false;
	}

	// Tab or Enter - select file
	if (key.tab || key.return) {
		if (filteredFileCount > 0 && fileSelectedIndex < filteredFileCount) {
			// Multi-select: if any items are checked, insert all of them at
			// once and clear the checkboxes. Fall back to single-select when
			// nothing is checked.
			const multipleFiles = fileListRef.current?.getSelectedFiles?.();
			if (multipleFiles && multipleFiles.length > 0) {
				if (handleMultipleFileSelect) {
					handleMultipleFileSelect(multipleFiles);
				} else {
					// Backwards-compatible fallback: insert sequentially.
					(async () => {
						for (const file of multipleFiles) {
							// eslint-disable-next-line no-await-in-loop
							await handleFileSelect(file);
						}
					})();
				}
				fileListRef.current?.clearSelections?.();
				return true;
			}

			const selectedFile = fileListRef.current?.getSelectedFile();
			if (selectedFile) {
				const displayName = fileListRef.current?.getSelectedDisplayName?.();
				handleFileSelect(selectedFile, displayName ?? undefined);
			}
		}
		return true;
	}
	return false;
}
