import React from 'react';
import ConfigScreen from '../../pages/ConfigScreen.js';

type Props = {
	/** 要编辑的 profile 名称（来自 ProfilePanel 当前光标焦点项） */
	profileName: string;
	/**
	 * 关闭面板回调（ESC 触发）。ConfigScreen 内部会先保存再调用 onBack。
	 */
	onClose: () => void;
};

/**
 * 配置文件编辑面板：包装 ConfigScreen，让用户在不切换 active profile 的前提下，
 * 编辑 ProfilePanel 中光标焦点指向的 profile。
 *
 * - inlineMode=true：复用 ChatScreen 的内联面板风格，去除标题边框
 * - targetProfileName：指示 useConfigState 从该 profile 加载并仅写回该 profile
 * - onBack/onSave 都映射到 onClose：ESC 保存并返回上一级 ProfilePanel
 */
export default function ProfileEditPanel({profileName, onClose}: Props) {
	return (
		<ConfigScreen
			onBack={onClose}
			onSave={onClose}
			inlineMode
			targetProfileName={profileName}
		/>
	);
}
