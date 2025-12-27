import katex from 'katex';

/**
 * 将LaTeX数学公式转换为Unicode文本（终端友好）
 * 通过KaTeX解析LaTeX并使用Unicode数学符号近似显示
 */
export function latexToUnicode(latex: string, displayMode = false): string {
	try {
		// 使用KaTeX渲染为HTML
		const html = katex.renderToString(latex, {
			displayMode,
			throwOnError: false,
			output: 'html',
		});

		// 从HTML中提取文本并转换为Unicode数学符号
		let result = html
			// 移除HTML标签
			.replace(/<[^>]+>/g, '')
			// 解码HTML实体
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&')
			.replace(/&nbsp;/g, ' ')
			// 移除多余空格
			.replace(/\s+/g, ' ')
			.trim();

		// 如果是显示模式（块级公式），添加换行
		if (displayMode) {
			result = `\n${result}\n`;
		}

		return result || latex; // 如果转换失败，返回原始LaTeX
	} catch (error) {
		// 转换失败时返回原始LaTeX
		return latex;
	}
}

/**
 * LaTeX符号到Unicode数学符号的映射表
 * 用于更精确的符号替换
 */
const LATEX_TO_UNICODE_MAP: Record<string, string> = {
	// 希腊字母
	'\\alpha': 'α',
	'\\beta': 'β',
	'\\gamma': 'γ',
	'\\delta': 'δ',
	'\\epsilon': 'ε',
	'\\zeta': 'ζ',
	'\\eta': 'η',
	'\\theta': 'θ',
	'\\iota': 'ι',
	'\\kappa': 'κ',
	'\\lambda': 'λ',
	'\\mu': 'μ',
	'\\nu': 'ν',
	'\\xi': 'ξ',
	'\\pi': 'π',
	'\\rho': 'ρ',
	'\\sigma': 'σ',
	'\\tau': 'τ',
	'\\upsilon': 'υ',
	'\\phi': 'φ',
	'\\chi': 'χ',
	'\\psi': 'ψ',
	'\\omega': 'ω',

	// 大写希腊字母
	'\\Gamma': 'Γ',
	'\\Delta': 'Δ',
	'\\Theta': 'Θ',
	'\\Lambda': 'Λ',
	'\\Xi': 'Ξ',
	'\\Pi': 'Π',
	'\\Sigma': 'Σ',
	'\\Upsilon': 'Υ',
	'\\Phi': 'Φ',
	'\\Psi': 'Ψ',
	'\\Omega': 'Ω',

	// 数学运算符
	'\\pm': '±',
	'\\mp': '∓',
	'\\times': '×',
	'\\div': '÷',
	'\\cdot': '⋅',
	'\\ast': '∗',
	'\\star': '⋆',
	'\\circ': '∘',
	'\\bullet': '•',

	// 关系符号
	'\\leq': '≤',
	'\\geq': '≥',
	'\\neq': '≠',
	'\\approx': '≈',
	'\\equiv': '≡',
	'\\sim': '∼',
	'\\simeq': '≃',
	'\\cong': '≅',
	'\\propto': '∝',

	// 集合符号
	'\\in': '∈',
	'\\notin': '∉',
	'\\subset': '⊂',
	'\\supset': '⊃',
	'\\subseteq': '⊆',
	'\\supseteq': '⊇',
	'\\cup': '∪',
	'\\cap': '∩',
	'\\emptyset': '∅',

	// 逻辑符号
	'\\land': '∧',
	'\\lor': '∨',
	'\\neg': '¬',
	'\\forall': '∀',
	'\\exists': '∃',

	// 箭头
	'\\rightarrow': '→',
	'\\leftarrow': '←',
	'\\leftrightarrow': '↔',
	'\\Rightarrow': '⇒',
	'\\Leftarrow': '⇐',
	'\\Leftrightarrow': '⇔',

	// 积分、求和、乘积
	'\\int': '∫',
	'\\iint': '∬',
	'\\iiint': '∭',
	'\\oint': '∮',
	'\\sum': '∑',
	'\\prod': '∏',

	// 其他数学符号
	'\\infty': '∞',
	'\\nabla': '∇',
	'\\partial': '∂',
	'\\sqrt': '√',
	'\\angle': '∠',
	'\\perp': '⊥',
	'\\parallel': '∥',
};

/**
 * 简单的LaTeX到Unicode转换（用于无法解析的LaTeX）
 * 使用符号映射表进行基本替换
 */
export function simpleLatexToUnicode(latex: string): string {
	let result = latex;

	// 替换LaTeX命令为Unicode符号
	for (const [latexCmd, unicodeChar] of Object.entries(LATEX_TO_UNICODE_MAP)) {
		result = result.replace(new RegExp(latexCmd.replace(/\\/g, '\\\\'), 'g'), unicodeChar);
	}

	// 处理上标 (^)
	result = result.replace(/\^(\d+)/g, (_, num) => {
		const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';
		return num
			.split('')
			.map((d: string) => superscripts[parseInt(d, 10)])
			.join('');
	});

	// 处理下标 (_)
	result = result.replace(/_(\d+)/g, (_, num) => {
		const subscripts = '₀₁₂₃₄₅₆₇₈₉';
		return num
			.split('')
			.map((d: string) => subscripts[parseInt(d, 10)])
			.join('');
	});

	// 移除花括号
	result = result.replace(/[{}]/g, '');

	return result;
}
