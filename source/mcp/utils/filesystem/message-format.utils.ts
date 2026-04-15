import type {Diagnostic} from '../../../utils/ui/vscodeConnection.js';
import type {StructureAnalysis} from '../../types/filesystem.types.js';

type DiagnosticsSummaryOptions = {
	headerLabel?: string;
	detailsLabel?: string;
	maxDetails?: number;
	moreSuffix?: string;
	includeTip?: boolean;
	tipText?: string;
};

export function appendDiagnosticsSummary(
	baseMessage: string,
	filePath: string,
	diagnostics: Diagnostic[],
	options: DiagnosticsSummaryOptions = {},
): string {
	const {
		headerLabel = 'Diagnostics detected',
		detailsLabel = 'Diagnostic Details',
		maxDetails = 5,
		moreSuffix = 'more issue(s)',
		includeTip = false,
		tipText = '⚡ TIP: Review the errors above and make another edit to fix them',
	} = options;

	const errorCount = diagnostics.filter(d => d.severity === 'error').length;
	const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

	if (errorCount === 0 && warningCount === 0) {
		return baseMessage;
	}

	let message = `${baseMessage}\n\n⚠️  ${headerLabel}: ${errorCount} error(s), ${warningCount} warning(s)`;
	const formattedDiagnostics = diagnostics
		.filter(d => d.severity === 'error' || d.severity === 'warning')
		.slice(0, maxDetails)
		.map(d => {
			const icon = d.severity === 'error' ? '❌' : '⚠️';
			const location = `${filePath}:${d.line}:${d.character}`;
			return `   ${icon} [${d.source || 'unknown'}] ${location}\n      ${d.message}`;
		})
		.join('\n\n');

	message += `\n\n📋 ${detailsLabel}:\n${formattedDiagnostics}`;
	if (errorCount + warningCount > maxDetails) {
		message += `\n   ... and ${errorCount + warningCount - maxDetails} ${moreSuffix}`;
	}
	if (includeTip) {
		message += `\n\n   ${tipText}`;
	}

	return message;
}

function getStructureWarnings(structureAnalysis: StructureAnalysis): string[] {
	const warnings: string[] = [];

	if (!structureAnalysis.bracketBalance.curly.balanced) {
		const diff =
			structureAnalysis.bracketBalance.curly.open -
			structureAnalysis.bracketBalance.curly.close;
		warnings.push(
			`Curly brackets: ${
				diff > 0 ? `${diff} unclosed {` : `${Math.abs(diff)} extra }`
			}`,
		);
	}
	if (!structureAnalysis.bracketBalance.round.balanced) {
		const diff =
			structureAnalysis.bracketBalance.round.open -
			structureAnalysis.bracketBalance.round.close;
		warnings.push(
			`Round brackets: ${
				diff > 0 ? `${diff} unclosed (` : `${Math.abs(diff)} extra )`
			}`,
		);
	}
	if (!structureAnalysis.bracketBalance.square.balanced) {
		const diff =
			structureAnalysis.bracketBalance.square.open -
			structureAnalysis.bracketBalance.square.close;
		warnings.push(
			`Square brackets: ${
				diff > 0 ? `${diff} unclosed [` : `${Math.abs(diff)} extra ]`
			}`,
		);
	}

	if (structureAnalysis.htmlTags && !structureAnalysis.htmlTags.balanced) {
		if (structureAnalysis.htmlTags.unclosedTags.length > 0) {
			warnings.push(
				`Unclosed HTML tags: ${structureAnalysis.htmlTags.unclosedTags.join(', ')}`,
			);
		}
		if (structureAnalysis.htmlTags.unopenedTags.length > 0) {
			warnings.push(
				`Unopened closing tags: ${structureAnalysis.htmlTags.unopenedTags.join(', ')}`,
			);
		}
	}

	if (structureAnalysis.indentationWarnings.length > 0) {
		warnings.push(
			...structureAnalysis.indentationWarnings.map(
				(warning: string) => `Indentation: ${warning}`,
			),
		);
	}

	return warnings;
}

export function appendStructureWarnings(
	baseMessage: string,
	structureAnalysis: StructureAnalysis,
	tipText: string = '💡 TIP: These warnings help identify potential issues.',
): string {
	const warnings = getStructureWarnings(structureAnalysis);
	if (warnings.length === 0) {
		return baseMessage;
	}

	let message = `${baseMessage}\n\n🔍 Structure Analysis:\n`;
	warnings.forEach(warning => {
		message += `   ⚠️  ${warning}\n`;
	});
	message += `\n   ${tipText}`;
	return message;
}
