package com.snow.plugin

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Tracks editor context and sends updates to Snow CLI
 */
class SnowEditorContextTracker(private val project: Project) {
    private val logger = Logger.getInstance(SnowEditorContextTracker::class.java)
    private val wsManager = SnowWebSocketManager.instance
    private var currentEditor: Editor? = null

    init {
        setupListeners()
    }

    /**
     * Setup editor listeners
     */
    private fun setupListeners() {
        // Listen to file editor changes
        val connection = project.messageBus.connect()
        connection.subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun selectionChanged(event: FileEditorManagerEvent) {
                    val editor = FileEditorManager.getInstance(project).selectedTextEditor
                    setupEditorListeners(editor)
                    sendEditorContext()
                }

                override fun fileOpened(source: FileEditorManager, file: VirtualFile) {
                    sendEditorContext()
                }
            }
        )
    }

    /**
     * Setup listeners for a specific editor
     */
    private fun setupEditorListeners(editor: Editor?) {
        // Remove old listeners by tracking current editor
        if (editor == currentEditor) {
            return
        }

        currentEditor = editor

        if (editor == null) {
            return
        }

        // Add caret listener for cursor position changes
        editor.caretModel.addCaretListener(object : CaretListener {
            override fun caretPositionChanged(event: CaretEvent) {
                sendEditorContext()
            }
        })

        // Add selection listener
        editor.selectionModel.addSelectionListener(object : SelectionListener {
            override fun selectionChanged(event: SelectionEvent) {
                sendEditorContext()
            }
        })
    }

    /**
     * Send current editor context to Snow CLI
     */
    fun sendEditorContext() {
        ApplicationManager.getApplication().runReadAction {
            try {
                val editor = FileEditorManager.getInstance(project).selectedTextEditor
                val context = buildContext(editor)

                wsManager.sendMessage(context)
            } catch (e: Exception) {
                logger.warn("Failed to send editor context", e)
            }
        }
    }

    /**
     * Build context map from current editor state
     */
    private fun buildContext(editor: Editor?): Map<String, Any?> {
        val context = mutableMapOf<String, Any?>(
            "type" to "context"
        )

        // Get workspace folder (always include)
        project.basePath?.let { context["workspaceFolder"] = it }

        // Get active file (try to get even if editor is null)
        val virtualFile = FileEditorManager.getInstance(project).selectedFiles.firstOrNull()
        virtualFile?.path?.let {
            context["activeFile"] = it
        }

        // If no editor, still return context with file info
        if (editor == null) {
            return context
        }

        // Get cursor position
        val caretModel = editor.caretModel
        val position = mapOf(
            "line" to caretModel.logicalPosition.line,
            "character" to caretModel.logicalPosition.column
        )
        context["cursorPosition"] = position

        // Get selected text
        val selectionModel = editor.selectionModel
        if (selectionModel.hasSelection()) {
            val selectedText = selectionModel.selectedText
            context["selectedText"] = selectedText
        }

        return context
    }

    /**
     * Get current virtual file
     */
    fun getCurrentFile(): VirtualFile? {
        return FileEditorManager.getInstance(project).selectedFiles.firstOrNull()
    }

    /**
     * Get current editor
     */
    fun getCurrentEditor(): Editor? {
        return FileEditorManager.getInstance(project).selectedTextEditor
    }
}
