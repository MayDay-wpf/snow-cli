package com.snow.plugin

import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiManager
import com.intellij.psi.search.searches.ReferencesSearch
import com.intellij.psi.util.PsiTreeUtil
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiNamedElement
import com.intellij.psi.PsiFile
import com.intellij.codeInsight.navigation.actions.GotoDeclarationAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory

/**
 * Handles code navigation features (go to definition, find references, get symbols)
 */
class SnowCodeNavigator(private val project: Project) {

    /**
     * Go to definition at specified location
     */
    fun goToDefinition(filePath: String, line: Int, column: Int): List<Map<String, Any?>> {
        val file = VirtualFileManager.getInstance().findFileByUrl("file://$filePath") ?: return emptyList()
        val psiFile = PsiManager.getInstance(project).findFile(file) ?: return emptyList()
        val document = PsiDocumentManager.getInstance(project).getDocument(psiFile) ?: return emptyList()

        if (line >= document.lineCount) return emptyList()

        val offset = document.getLineStartOffset(line) + column
        val element = psiFile.findElementAt(offset) ?: return emptyList()

        // Navigate to declaration
        val references = element.references
        val definitions = mutableListOf<Map<String, Any?>>()

        for (reference in references) {
            val resolved = reference.resolve() ?: continue
            val containingFile = resolved.containingFile?.virtualFile ?: continue
            val doc = PsiDocumentManager.getInstance(project).getDocument(resolved.containingFile) ?: continue
            val textRange = resolved.textRange

            definitions.add(
                mapOf(
                    "filePath" to containingFile.path,
                    "line" to doc.getLineNumber(textRange.startOffset),
                    "column" to textRange.startOffset - doc.getLineStartOffset(doc.getLineNumber(textRange.startOffset)),
                    "endLine" to doc.getLineNumber(textRange.endOffset),
                    "endColumn" to textRange.endOffset - doc.getLineStartOffset(doc.getLineNumber(textRange.endOffset))
                )
            )
        }

        return definitions
    }

    /**
     * Find all references to element at specified location
     */
    fun findReferences(filePath: String, line: Int, column: Int): List<Map<String, Any?>> {
        val file = VirtualFileManager.getInstance().findFileByUrl("file://$filePath") ?: return emptyList()
        val psiFile = PsiManager.getInstance(project).findFile(file) ?: return emptyList()
        val document = PsiDocumentManager.getInstance(project).getDocument(psiFile) ?: return emptyList()

        if (line >= document.lineCount) return emptyList()

        val offset = document.getLineStartOffset(line) + column
        val element = psiFile.findElementAt(offset) ?: return emptyList()

        // Find the parent named element
        val namedElement = PsiTreeUtil.getParentOfType(element, PsiNamedElement::class.java) ?: return emptyList()

        // Search for references
        val references = ReferencesSearch.search(namedElement, namedElement.useScope).findAll()
        val results = mutableListOf<Map<String, Any?>>()

        for (reference in references) {
            val refElement = reference.element
            val refFile = refElement.containingFile?.virtualFile ?: continue
            val refDoc = PsiDocumentManager.getInstance(project).getDocument(refElement.containingFile) ?: continue
            val textRange = refElement.textRange

            results.add(
                mapOf(
                    "filePath" to refFile.path,
                    "line" to refDoc.getLineNumber(textRange.startOffset),
                    "column" to textRange.startOffset - refDoc.getLineStartOffset(refDoc.getLineNumber(textRange.startOffset)),
                    "endLine" to refDoc.getLineNumber(textRange.endOffset),
                    "endColumn" to textRange.endOffset - refDoc.getLineStartOffset(refDoc.getLineNumber(textRange.endOffset))
                )
            )
        }

        return results
    }

    /**
     * Get all symbols in the file
     */
    fun getSymbols(filePath: String): List<Map<String, Any?>> {
        val file = VirtualFileManager.getInstance().findFileByUrl("file://$filePath") ?: return emptyList()
        val psiFile = PsiManager.getInstance(project).findFile(file) ?: return emptyList()
        val document = PsiDocumentManager.getInstance(project).getDocument(psiFile) ?: return emptyList()

        val symbols = mutableListOf<Map<String, Any?>>()

        // Recursively collect named elements
        fun collectSymbols(element: PsiElement) {
            if (element is PsiNamedElement && element.name != null) {
                val textRange = element.textRange
                val startLine = document.getLineNumber(textRange.startOffset)
                val endLine = document.getLineNumber(textRange.endOffset)

                symbols.add(
                    mapOf(
                        "name" to element.name,
                        "kind" to getSymbolKind(element),
                        "line" to startLine,
                        "column" to textRange.startOffset - document.getLineStartOffset(startLine),
                        "endLine" to endLine,
                        "endColumn" to textRange.endOffset - document.getLineStartOffset(endLine),
                        "detail" to (element.text.take(50) + if (element.text.length > 50) "..." else "")
                    )
                )
            }

            for (child in element.children) {
                collectSymbols(child)
            }
        }

        collectSymbols(psiFile)
        return symbols
    }

    /**
     * Get symbol kind from PSI element type
     */
    private fun getSymbolKind(element: PsiElement): String {
        val className = element.javaClass.simpleName
        return when {
            className.contains("Class") -> "Class"
            className.contains("Method") || className.contains("Function") -> "Method"
            className.contains("Field") || className.contains("Property") -> "Field"
            className.contains("Variable") -> "Variable"
            className.contains("Interface") -> "Interface"
            className.contains("Enum") -> "Enum"
            className.contains("Constant") -> "Constant"
            className.contains("Constructor") -> "Constructor"
            className.contains("Module") || className.contains("Package") -> "Module"
            else -> "Unknown"
        }
    }
}
