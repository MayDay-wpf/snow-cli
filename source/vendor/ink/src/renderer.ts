import renderNodeToOutput from './render-node-to-output.js';
import Output from './output.js';
import {type DOMElement} from './dom.js';

type Result = {
	output: string;
	outputHeight: number;
	staticOutput: string;
};

export default function createRenderer(node: DOMElement): () => Result {
	let mainOutput: Output | undefined;
	let staticOutputObj: Output | undefined;

	return () => {
		if (!node.yogaNode) {
			return {
				output: '',
				outputHeight: 0,
				staticOutput: '',
			};
		}

		const width = node.yogaNode.getComputedWidth();
		const height = node.yogaNode.getComputedHeight();

		if (mainOutput) {
			mainOutput.reset(width, height);
		} else {
			mainOutput = new Output({width, height});
		}

		renderNodeToOutput(node, mainOutput, {skipStaticElements: true});

		let staticResult = '';

		if (node.staticNode?.yogaNode) {
			const sw = node.staticNode.yogaNode.getComputedWidth();
			const sh = node.staticNode.yogaNode.getComputedHeight();

			if (staticOutputObj) {
				staticOutputObj.reset(sw, sh);
			} else {
				staticOutputObj = new Output({width: sw, height: sh});
			}

			renderNodeToOutput(node.staticNode, staticOutputObj, {
				skipStaticElements: false,
			});

			staticResult = `${staticOutputObj.get().output}\n`;
		}

		const {output: generatedOutput, height: outputHeight} = mainOutput.get();

		return {
			output: generatedOutput,
			outputHeight,
			staticOutput: staticResult,
		};
	};
}
