package com.snow.plugin.completion

import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorCustomElementRenderer
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.openapi.editor.markup.TextAttributes
import java.awt.Color
import java.awt.Graphics
import java.awt.Rectangle

class SnowInlineRenderer(private val text: String) : EditorCustomElementRenderer {

    override fun calcWidthInPixels(inlay: Inlay<*>): Int {
        val editor = inlay.editor
        val metrics = editor.contentComponent.getFontMetrics(
            editor.colorsScheme.getFont(EditorFontType.ITALIC)
        )
        return metrics.stringWidth(text)
    }

    override fun paint(inlay: Inlay<*>, g: Graphics, targetRegion: Rectangle, textAttributes: TextAttributes) {
        val editor = inlay.editor
        val font = editor.colorsScheme.getFont(EditorFontType.ITALIC)
        g.font = font
        g.color = ghostColor(editor)
        val metrics = g.fontMetrics
        val y = targetRegion.y + metrics.ascent
        g.drawString(text, targetRegion.x, y)
    }

    private fun ghostColor(editor: Editor): Color {
        val fg = editor.colorsScheme.defaultForeground
        val bg = editor.colorsScheme.defaultBackground
        return Color(
            blend(fg.red, bg.red),
            blend(fg.green, bg.green),
            blend(fg.blue, bg.blue),
            160,
        )
    }

    private fun blend(fg: Int, bg: Int): Int = (fg * 0.45 + bg * 0.55).toInt().coerceIn(0, 255)
}

class SnowBlockRenderer(private val lines: List<String>) : EditorCustomElementRenderer {

    override fun calcWidthInPixels(inlay: Inlay<*>): Int {
        if (lines.isEmpty()) return 0
        val editor = inlay.editor
        val metrics = editor.contentComponent.getFontMetrics(
            editor.colorsScheme.getFont(EditorFontType.ITALIC)
        )
        return lines.maxOf { metrics.stringWidth(it) }
    }

    override fun calcHeightInPixels(inlay: Inlay<*>): Int {
        val editor = inlay.editor
        return editor.lineHeight * lines.size
    }

    override fun paint(inlay: Inlay<*>, g: Graphics, targetRegion: Rectangle, textAttributes: TextAttributes) {
        val editor = inlay.editor
        val font = editor.colorsScheme.getFont(EditorFontType.ITALIC)
        g.font = font
        g.color = ghostColor(editor)
        val metrics = g.fontMetrics
        val lineHeight = editor.lineHeight
        for ((i, line) in lines.withIndex()) {
            val y = targetRegion.y + i * lineHeight + metrics.ascent
            g.drawString(line, targetRegion.x, y)
        }
    }

    private fun ghostColor(editor: Editor): Color {
        val fg = editor.colorsScheme.defaultForeground
        val bg = editor.colorsScheme.defaultBackground
        return Color(
            blend(fg.red, bg.red),
            blend(fg.green, bg.green),
            blend(fg.blue, bg.blue),
            160,
        )
    }

    private fun blend(fg: Int, bg: Int): Int = (fg * 0.45 + bg * 0.55).toInt().coerceIn(0, 255)
}
