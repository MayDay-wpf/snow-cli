import type {ImageContent} from '../../api/types.js';
import type {MultimodalContent} from '../../mcp/types/filesystem.types.js';

export function isMultimodalContent(value: any): value is MultimodalContent {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(item: any) =>
				item &&
				typeof item === 'object' &&
				(item.type === 'text' || item.type === 'image'),
		)
	);
}

export function extractMultimodalContent(result: any): {
	textContent: string;
	images?: ImageContent[];
} {
	let contentToCheck = result;

	if (result && typeof result === 'object' && result.content) {
		contentToCheck = result.content;
	}

	if (isMultimodalContent(contentToCheck)) {
		const textParts: string[] = [];
		const images: ImageContent[] = [];

		for (const item of contentToCheck) {
			if (item.type === 'text') {
				textParts.push(item.text);
			} else if (item.type === 'image') {
				images.push({
					type: 'image',
					data: item.data,
					mimeType: item.mimeType,
				});
			}
		}

		if (
			result &&
			typeof result === 'object' &&
			result.content === contentToCheck
		) {
			const resultKeys = Object.keys(result);
			if (resultKeys.length === 1 && resultKeys[0] === 'content') {
				return {
					textContent: textParts.join('\n\n'),
					images: images.length > 0 ? images : undefined,
				};
			}

			const newResult = {...result, content: textParts.join('\n\n')};
			return {
				textContent: JSON.stringify(newResult),
				images: images.length > 0 ? images : undefined,
			};
		}

		return {
			textContent: textParts.join('\n\n'),
			images: images.length > 0 ? images : undefined,
		};
	}

	if (typeof result === 'string') {
		return {textContent: result};
	}
	return {
		textContent: JSON.stringify(result),
	};
}
