import type {HandlerContext} from '../../types.js';

export function filePickerHandler(ctx: HandlerContext): boolean {
	const {key, options} = ctx;
	const {
		showFilePicker,
		filteredFileCount,
		fileSelectedIndex,
		setFileSelectedIndex,
		fileListRef,
		handleFileSelect,
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

	// Tab or Enter - select file
	if (key.tab || key.return) {
		if (filteredFileCount > 0 && fileSelectedIndex < filteredFileCount) {
			const selectedFile = fileListRef.current?.getSelectedFile();
			if (selectedFile) {
				handleFileSelect(selectedFile);
			}
		}
		return true;
	}

	return false;
}
