/**
 * Office file parsing utilities
 * Handles parsing of PDF, Word, Excel, and PowerPoint files
 */

import {promises as fs} from 'fs';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type {DocumentContent} from '../../types/filesystem.types.js';
import {OFFICE_FILE_TYPES} from '../../types/filesystem.types.js';
import * as path from 'path';

/**
 * Parse Word document (.docx, .doc)
 * @param fullPath - Full path to the Word document
 * @returns DocumentContent object with extracted text
 */
export async function parseWordDocument(
	fullPath: string,
): Promise<DocumentContent | null> {
	try {
		const buffer = await fs.readFile(fullPath);
		const result = await mammoth.extractRawText({buffer});

		return {
			type: 'document',
			text: result.value,
			fileType: 'word',
			metadata: {
				messages: result.messages.length > 0 ? result.messages : undefined,
			},
		};
	} catch (error) {
		console.error(`Failed to parse Word document ${fullPath}:`, error);
		return null;
	}
}

/**
 * Parse PDF document
 * @param fullPath - Full path to the PDF file
 * @returns DocumentContent object with extracted text
 */
export async function parsePDFDocument(
	fullPath: string,
): Promise<DocumentContent | null> {
	try {
		// DOMMatrix/ImageData/Path2D polyfills are injected via build.mjs banner
		// so they exist before pdfjs-dist module-level code executes in the bundle.
		const {PDFParse} = await import('pdf-parse');

		const workerPath = new URL('pdf.worker.mjs', import.meta.url).href;
		PDFParse.setWorker(workerPath);

		const buffer = await fs.readFile(fullPath);
		const uint8Array = new Uint8Array(buffer);

		const parser = new PDFParse({data: uint8Array});
		const data = await parser.getText();

		return {
			type: 'document',
			text: data.text,
			fileType: 'pdf',
			metadata: {
				pages: data.total,
			},
		};
	} catch (error) {
		console.error(`Failed to parse PDF document ${fullPath}:`, error);
		return null;
	}
}

/**
 * Parse Excel spreadsheet (.xlsx, .xls)
 * @param fullPath - Full path to the Excel file
 * @returns DocumentContent object with extracted text
 */
export async function parseExcelDocument(
	fullPath: string,
): Promise<DocumentContent | null> {
	try {
		const buffer = await fs.readFile(fullPath);
		const workbook = XLSX.read(buffer, {type: 'buffer'});

		const sheets: string[] = [];
		let allText = '';

		workbook.SheetNames.forEach(sheetName => {
			sheets.push(sheetName);
			const worksheet = workbook.Sheets[sheetName];
			if (worksheet) {
				const sheetText = XLSX.utils.sheet_to_txt(worksheet);
				allText += `\n\n=== Sheet: ${sheetName} ===\n${sheetText}`;
			}
		});

		return {
			type: 'document',
			text: allText.trim(),
			fileType: 'excel',
			metadata: {
				sheets,
				sheetCount: sheets.length,
			},
		};
	} catch (error) {
		console.error(`Failed to parse Excel document ${fullPath}:`, error);
		return null;
	}
}

/**
 * Parse PowerPoint presentation (.pptx, .ppt)
 * Note: PowerPoint parsing is complex and requires unzipping the .pptx file
 * This is a placeholder implementation
 * @param fullPath - Full path to the PowerPoint file
 * @returns DocumentContent object with extracted text
 */
export async function parsePowerPointDocument(
	fullPath: string,
): Promise<DocumentContent | null> {
	try {
		// PowerPoint parsing requires extracting and parsing XML from the .pptx archive
		// A full implementation would use JSZip to extract slide XML files
		// and parse them to extract text content
		// For now, return a placeholder message
		return {
			type: 'document',
			text: '[PowerPoint parsing not fully implemented yet. Please use a specialized tool to extract text from .pptx files.]',
			fileType: 'powerpoint',
			metadata: {
				note: 'PowerPoint text extraction requires additional implementation',
				suggestion:
					'Consider using external tools or libraries like python-pptx for full PowerPoint text extraction',
			},
		};
	} catch (error) {
		console.error(`Failed to parse PowerPoint document ${fullPath}:`, error);
		return null;
	}
}

/**
 * Get Office file type based on extension
 * @param filePath - Path to the file
 * @returns File type or undefined
 */
export function getOfficeFileType(
	filePath: string,
): 'pdf' | 'word' | 'excel' | 'powerpoint' | undefined {
	const ext = path.extname(filePath).toLowerCase();
	return OFFICE_FILE_TYPES[ext];
}

/**
 * Main entry point: Read and parse Office document
 * @param fullPath - Full path to the Office document
 * @returns DocumentContent object with extracted text
 */
export async function readOfficeDocument(
	fullPath: string,
): Promise<DocumentContent | null> {
	const fileType = getOfficeFileType(fullPath);
	if (!fileType) {
		return null;
	}

	let docContent: DocumentContent | null = null;

	switch (fileType) {
		case 'word': {
			docContent = await parseWordDocument(fullPath);
			break;
		}

		case 'pdf': {
			docContent = await parsePDFDocument(fullPath);
			break;
		}

		case 'excel': {
			docContent = await parseExcelDocument(fullPath);
			break;
		}

		case 'powerpoint': {
			docContent = await parsePowerPointDocument(fullPath);
			break;
		}
	}

	return docContent;
}
