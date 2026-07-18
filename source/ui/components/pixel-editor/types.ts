export type PixelColor = string; // hex color like #RRGGBB

export type PixelGrid = PixelColor[][]; // grid[y][x]

export interface PixelEditorProps {
	width?: number;
	height?: number;
	onExit?: () => void;
}
