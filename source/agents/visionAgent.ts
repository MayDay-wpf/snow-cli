import {
	getSnowConfig,
	type ApiConfig,
	type RequestMethod,
} from '../utils/config/apiConfig.js';
import {logger} from '../utils/core/logger.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {ImageContent} from '../api/types.js';

export type VisionFallbackSource = 'user' | 'tool';

export interface VisionProcessOptions {
	source: VisionFallbackSource;
	abortSignal?: AbortSignal;
}

export interface VisionProcessResult {
	content: string;
	images?: ImageContent[];
}

const IMAGE_UNAVAILABLE_NOTICE =
	'Visual processing hint: The current main model does not support image recognition, and the image field in this message has been removed by the system; due to the lack of a configured available visual model or failure in the visual model call, the image content cannot be provided. Please do not claim that you have seen these images.';
const VISION_CONTEXT_MAX_CHARS = 4000;

function buildSourceContext(content: string): string | null {
	const trimmedContent = content?.trim() || '';
	if (!trimmedContent) {
		return null;
	}

	if (trimmedContent.length <= VISION_CONTEXT_MAX_CHARS) {
		return trimmedContent;
	}

	return `${trimmedContent.slice(0, VISION_CONTEXT_MAX_CHARS)}\n...[truncated]`;
}

function normalizeImageData(image: ImageContent): ImageContent {
	const data = image.data?.trim() || '';
	if (!data || /^https?:\/\//i.test(data) || /^data:/i.test(data)) {
		return image;
	}

	const mimeType = image.mimeType?.trim() || 'image/png';
	return {
		...image,
		data: `data:${mimeType};base64,${data}`,
		mimeType,
	};
}

function buildVisionConfigOverride(
	config: ApiConfig,
): Partial<ApiConfig> | null {
	const visionModel = config.visionModel?.trim();
	if (!visionModel) {
		return null;
	}

	return {
		baseUrl: config.visionBaseUrl?.trim() || config.baseUrl,
		baseUrlMode: config.visionBaseUrlMode || config.baseUrlMode,
		apiKey: config.visionApiKey?.trim() || config.apiKey,
		requestMethod: config.visionRequestMethod || config.requestMethod,
		advancedModel: visionModel,
		basicModel: visionModel,
		supportsVision: true,
	};
}

function getConfiguredRequestMethod(config: ApiConfig): RequestMethod {
	return config.visionRequestMethod || config.requestMethod;
}

function buildDescriptionPrompt(
	imageCount: number,
	source: VisionFallbackSource,
	sourceContext?: string | null,
): string {
	const sourceLabel = source === 'tool' ? 'tool result' : 'user message';
	const contextBlock = sourceContext
		? `\n\nSource message content from the same ${sourceLabel} (use it to understand what the requester cares about in the image, such as alignment, highlighted areas, errors, comparison targets, or UI details):\n<source_message>\n${sourceContext}\n</source_message>`
		: '';

	return `The attached ${
		imageCount === 1 ? 'image is' : 'images are'
	} from a ${sourceLabel}. Describe each image accurately and concisely for another AI model that cannot see images.${contextBlock}

Requirements:
1. If there are multiple images, number them as Image 1, Image 2, etc.
2. Include visible text, UI elements, diagrams, charts, code, errors, layout, objects, and any relevant details.
3. Use the source message content to prioritize details that answer what the requester is asking about, but do not treat it as visual evidence by itself.
4. Do not invent details that are not visible.
5. Respond with plain text only.`;
}

function appendVisionText(content: string, addition: string): string {
	const trimmedContent = content?.trimEnd() || '';
	const trimmedAddition = addition.trim();
	if (!trimmedContent) {
		return trimmedAddition;
	}

	return `${trimmedContent}\n\n${trimmedAddition}`;
}

export class VisionAgent {
	shouldProcessImages(config: ApiConfig = getSnowConfig()): boolean {
		return config.supportsVision === false;
	}

	private async callModel(
		messages: ChatMessage[],
		config: ApiConfig,
		configOverride: Partial<ApiConfig>,
		abortSignal?: AbortSignal,
	): Promise<string> {
		const requestMethod = getConfiguredRequestMethod(config);
		const modelName = configOverride.advancedModel || config.visionModel || '';
		let streamGenerator: AsyncGenerator<any, void, unknown>;

		switch (requestMethod) {
			case 'anthropic':
				streamGenerator = createStreamingAnthropicCompletion(
					{
						model: modelName,
						messages,
						max_tokens: 1200,
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
						configOverride,
					},
					abortSignal,
				);
				break;
			case 'gemini':
				streamGenerator = createStreamingGeminiCompletion(
					{
						model: modelName,
						messages,
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
						configOverride,
					},
					abortSignal,
				);
				break;
			case 'responses':
				streamGenerator = createStreamingResponse(
					{
						model: modelName,
						messages,
						stream: true,
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
						configOverride,
					},
					abortSignal,
				);
				break;
			case 'chat':
			default:
				streamGenerator = createStreamingChatCompletion(
					{
						model: modelName,
						messages,
						stream: true,
						includeBuiltinSystemPrompt: false,
						disableThinking: true,
						configOverride,
					},
					abortSignal,
				);
				break;
		}

		let completeContent = '';
		for await (const chunk of streamGenerator) {
			if (abortSignal?.aborted) {
				throw new Error('Request aborted');
			}

			if (requestMethod === 'chat') {
				if (chunk.choices && chunk.choices[0]?.delta?.content) {
					completeContent += chunk.choices[0].delta.content;
				}
			} else if (chunk.type === 'content' && chunk.content) {
				completeContent += chunk.content;
			}
		}

		return completeContent.trim();
	}

	private async describeImages(
		images: ImageContent[],
		source: VisionFallbackSource,
		sourceContent?: string,
		abortSignal?: AbortSignal,
	): Promise<string | null> {
		const config = getSnowConfig();
		const configOverride = buildVisionConfigOverride(config);
		if (!configOverride) {
			return null;
		}

		const normalizedImages = images.map(normalizeImageData);
		const sourceContext = buildSourceContext(sourceContent || '');
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: buildDescriptionPrompt(
					normalizedImages.length,
					source,
					sourceContext,
				),
				images: normalizedImages,
			},
		];

		try {
			const description = await this.callModel(
				messages,
				config,
				configOverride,
				abortSignal,
			);
			return description || null;
		} catch (error) {
			logger.warn('Vision agent: failed to describe images', error);
			return null;
		}
	}

	async prepareContentForNonVisionModel(
		content: string,
		images: ImageContent[] | undefined,
		options: VisionProcessOptions,
	): Promise<VisionProcessResult> {
		if (!images || images.length === 0) {
			return {content, images};
		}

		const config = getSnowConfig();
		if (!this.shouldProcessImages(config)) {
			return {content, images};
		}

		const description = await this.describeImages(
			images,
			options.source,
			content,
			options.abortSignal,
		);
		const replacementText = description
			? `The current model does not support image recognition. The visual model has generated the following description for the image field：\n${description}`
			: IMAGE_UNAVAILABLE_NOTICE;

		return {
			content: appendVisionText(content, replacementText),
			images: undefined,
		};
	}

	async prepareToolResultForNonVisionModel<
		T extends {content: string; images?: ImageContent[]},
	>(result: T, abortSignal?: AbortSignal): Promise<T> {
		if (!result.images || result.images.length === 0) {
			return result;
		}

		const processed = await this.prepareContentForNonVisionModel(
			result.content,
			result.images,
			{source: 'tool', abortSignal},
		);

		return {
			...result,
			content: processed.content,
			images: processed.images,
		};
	}
}

export const visionAgent = new VisionAgent();
