import {createContext} from 'react';
import {type DOMElement} from '../dom.js';

export type CursorRegistration = {
	readonly nodeRef: {current: DOMElement | null};
	readonly offsetX: number;
	readonly offsetY: number;
};

export type Props = {
	readonly registerCursor: (
		registration: CursorRegistration | undefined,
	) => void;
};

const CursorContext = createContext<Props>({
	registerCursor() {},
});

CursorContext.displayName = 'InternalCursorContext';

export default CursorContext;
