package com.snow.plugin.nextEdit

import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorCustomElementRenderer
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.openapi.editor.markup.*
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.JBColor
import com.snow.plugin.config.SnowBundle
import java.awt.Color
import java.awt.Graphics
import java.awt.Rectangle
import java.io.File

class SnowNextEditDecoration(private val project: Project) : Disposable {
    private val highlighters = mutableListOf<RangeHighlighter>()
    private val inlays = mutableListOf<Inlay<*>>()
    private val touchedEditors = mutableSetOf<Editor>()

    fun show(anchorEditor: Editor, anchorLine: Int, current: Candidate, remaining: Int) {
        clear()
        touchedEditors.add(anchorEditor)
        val doc = anchorEditor.document
        val safeLine = anchorLine.coerceIn(0, doc.lineCount - 1)
        val lineEnd = doc.getLineEndOffset(safeLine)

        val hint = buildHintText(current, remaining, anchorEditor)
        val inlay = anchorEditor.inlayModel.addAfterLineEndElement(lineEnd, true, HintRenderer(hint))
        if (inlay != null) inlays.add(inlay)

        val targetEditor = findEditorForFile(current.file)
        if (targetEditor != null && targetEditor != anchorEditor) {
            touchedEditors.add(targetEditor)
            highlightTarget(targetEditor, current)
        } else if (current.file.path == com.intellij.openapi.fileEditor.FileDocumentManager.getInstance().getFile(anchorEditor.document)?.path) {
            highlightTarget(anchorEditor, current)
        }
    }

    private fun highlightTarget(editor: Editor, candidate: Candidate) {
        val doc = editor.document
        if (candidate.startOffset >= doc.textLength) return
        val safeEnd = candidate.endOffset.coerceAtMost(doc.textLength)

        val lineHighlighter = editor.markupModel.addLineHighlighter(
            doc.getLineNumber(candidate.startOffset),
            HighlighterLayer.SELECTION - 1,
            TextAttributes().apply {
                backgroundColor = JBColor(Color(0, 120, 215, 25), Color(100, 180, 255, 25))
            },
        )
        highlighters.add(lineHighlighter)

        if (candidate.startOffset < safeEnd) {
            val rangeHighlighter = editor.markupModel.addRangeHighlighter(
                candidate.startOffset,
                safeEnd,
                HighlighterLayer.SELECTION,
                TextAttributes().apply {
                    effectType = EffectType.BOXED
                    effectColor = JBColor(Color(0, 120, 215), Color(100, 180, 255))
                    backgroundColor = JBColor(Color(0, 120, 215, 40), Color(100, 180, 255, 40))
                },
                HighlighterTargetArea.EXACT_RANGE,
            )
            highlighters.add(rangeHighlighter)
        }
    }

    fun clear() {
        for (h in highlighters) {
            try { h.dispose() } catch (_: Exception) {}
        }
        highlighters.clear()
        for (inlay in inlays) {
            try { if (inlay.isValid) Disposer.dispose(inlay) } catch (_: Exception) {}
        }
        inlays.clear()
        touchedEditors.clear()
    }

    override fun dispose() {
        clear()
    }

    private fun findEditorForFile(file: VirtualFile): Editor? {
        val fem = FileEditorManager.getInstance(project)
        return fem.selectedTextEditor?.takeIf {
            com.intellij.openapi.fileEditor.FileDocumentManager.getInstance().getFile(it.document)?.path == file.path
        } ?: fem.allEditors.mapNotNull { fe ->
            (fe as? com.intellij.openapi.fileEditor.TextEditor)?.editor
        }.firstOrNull { ed ->
            com.intellij.openapi.fileEditor.FileDocumentManager.getInstance().getFile(ed.document)?.path == file.path
        }
    }

    private fun buildHintText(current: Candidate, remaining: Int, editor: Editor): String {
        val total = remaining + 1
        val currentFile = com.intellij.openapi.fileEditor.FileDocumentManager.getInstance().getFile(editor.document)
        val sameFile = currentFile?.path == current.file.path
        val doc = if (sameFile) editor.document else null
        val lineNum = doc?.let { it.getLineNumber(current.startOffset) + 1 } ?: 0
        val loc = if (sameFile) "L$lineNum" else "${File(current.file.path).name}:$lineNum"
        val countTag = if (total > 1) " (1/$total)" else ""

        val repl = current.replacement.take(24).let { if (current.replacement.length > 24) "$it..." else it }
        val base = SnowBundle.message("nextEdit.hint.replace", repl, loc, countTag)
        return if (current.reason.isNotBlank()) {
            val short = current.reason.take(60).let { if (current.reason.length > 60) "$it..." else it }
            "$base  ·  $short"
        } else {
            base
        }
    }
}

private class HintRenderer(private val text: String) : EditorCustomElementRenderer {
    override fun calcWidthInPixels(inlay: Inlay<*>): Int {
        val metrics = inlay.editor.contentComponent.getFontMetrics(
            inlay.editor.colorsScheme.getFont(EditorFontType.BOLD)
        )
        return metrics.stringWidth(text) + 16
    }

    override fun paint(inlay: Inlay<*>, g: Graphics, targetRegion: Rectangle, textAttributes: TextAttributes) {
        val editor = inlay.editor
        val font = editor.colorsScheme.getFont(EditorFontType.BOLD)
        g.font = font
        val metrics = g.fontMetrics

        val bg = JBColor(Color(0, 120, 215, 30), Color(100, 180, 255, 30))
        val fg = JBColor(Color(0, 100, 200), Color(130, 200, 255))
        val border = JBColor(Color(0, 120, 215, 80), Color(100, 180, 255, 80))

        g.color = bg
        g.fillRoundRect(targetRegion.x + 4, targetRegion.y + 1, targetRegion.width - 8, targetRegion.height - 2, 6, 6)
        g.color = border
        g.drawRoundRect(targetRegion.x + 4, targetRegion.y + 1, targetRegion.width - 8, targetRegion.height - 2, 6, 6)
        g.color = fg
        g.drawString(text, targetRegion.x + 8, targetRegion.y + metrics.ascent)
    }
}
