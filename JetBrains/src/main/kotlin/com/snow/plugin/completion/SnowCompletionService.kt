package com.snow.plugin.completion

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorKind
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.event.*
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.wm.WindowManager
import com.intellij.psi.PsiDocumentManager
import java.util.concurrent.*

@Service(Service.Level.APP)
class SnowCompletionService : Disposable {
    private val logger = Logger.getInstance(SnowCompletionService::class.java)
    private val editorStates = ConcurrentHashMap<Editor, EditorCompletionState>()
    private val executor = Executors.newCachedThreadPool { r ->
        Thread(r, "Snow-Completion").apply { isDaemon = true }
    }

    init {
        logger.info("SnowCompletionService initialized")

        for (editor in EditorFactory.getInstance().allEditors) {
            attachEditor(editor)
        }

        EditorFactory.getInstance().addEditorFactoryListener(object : EditorFactoryListener {
            override fun editorCreated(event: EditorFactoryEvent) {
                attachEditor(event.editor)
            }
            override fun editorReleased(event: EditorFactoryEvent) {
                detachEditor(event.editor)
            }
        }, this)
    }

    private fun attachEditor(editor: Editor) {
        if (editor.project == null) return
        if (editor.isViewer) return
        // Only the main code editor should receive AI completions. Skip the
        // built-in terminal, run/console output, debugger console, diff/preview
        // panes, image viewers, etc. (anything that is not EditorKind.MAIN_EDITOR).
        if (editor.editorKind != EditorKind.MAIN_EDITOR) return
        // Require a real backing VirtualFile. Scratch / fragment editors used
        // by inspections, completion popups, dialogs etc. have no file and
        // should not be tracked.
        val vFile = FileDocumentManager.getInstance().getFile(editor.document) ?: return
        if (!vFile.isInLocalFileSystem) return
        if (editorStates.containsKey(editor)) return
        val state = EditorCompletionState(editor, this)
        editorStates[editor] = state
        logger.info("Attached completion to editor: ${vFile.name}")
    }

    private fun detachEditor(editor: Editor) {
        editorStates.remove(editor)?.dispose()
    }

    fun hasCompletion(editor: Editor): Boolean = editorStates[editor]?.hasCompletion() == true

    fun tryAccept(editor: Editor): Boolean {
        val state = editorStates[editor] ?: return false
        return state.accept()
    }

    fun tryDismiss(editor: Editor): Boolean {
        val state = editorStates[editor] ?: return false
        return state.dismiss()
    }

    fun triggerManual(editor: Editor) {
        editorStates[editor]?.triggerNow()
    }

    internal fun submitRequest(task: Runnable): Future<*> = executor.submit(task)

    internal fun updateStatusBar(editor: Editor, loading: Boolean, message: String? = null) {
        val project = editor.project ?: return
        val statusBar = WindowManager.getInstance().getStatusBar(project) ?: return
        val widget = statusBar.getWidget(SnowCompletionStatusBarFactory.WIDGET_ID) as? SnowCompletionStatusBarWidget ?: return
        widget.loading = loading
        widget.message = message
        widget.update()
    }

    override fun dispose() {
        editorStates.values.forEach { it.dispose() }
        editorStates.clear()
        executor.shutdownNow()
    }

    companion object {
        fun getInstance(): SnowCompletionService =
            ApplicationManager.getApplication().getService(SnowCompletionService::class.java)
    }
}

private class EditorCompletionState(
    private val editor: Editor,
    private val service: SnowCompletionService,
) : Disposable {
    private val logger = Logger.getInstance(EditorCompletionState::class.java)
    private val config get() = SnowCompletionConfig.getInstance()

    @Volatile private var currentInlays = emptyList<Inlay<*>>()
    @Volatile private var completionText: String? = null
    @Volatile private var completionOffset: Int = -1
    @Volatile private var debounceTimer: ScheduledFuture<*>? = null
    @Volatile private var currentFuture: Future<*>? = null
    @Volatile private var suppressed = false

    private val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "Snow-Completion-Debounce").apply { isDaemon = true }
    }

    private val docListener = object : DocumentListener {
        override fun documentChanged(event: DocumentEvent) {
            if (suppressed) return
            dismissInlays()
            scheduleCompletion()
        }
    }

    private val caretListener = object : CaretListener {
        override fun caretPositionChanged(event: CaretEvent) {
            if (suppressed) return
            if (completionText != null) {
                val offset = editor.caretModel.offset
                if (offset != completionOffset) {
                    dismissInlays()
                }
            }
        }
    }

    init {
        editor.document.addDocumentListener(docListener)
        editor.caretModel.addCaretListener(caretListener)
    }

    fun hasCompletion(): Boolean = completionText != null && currentInlays.isNotEmpty()

    fun accept(): Boolean {
        val text = completionText ?: return false
        val offset = completionOffset
        if (offset < 0 || offset > editor.document.textLength) return false

        suppressed = true
        dismissInlays()
        try {
            val project = editor.project
            // Use WriteCommandAction so the insertion is one undoable command
            // and is NOT post-processed by other write-action callbacks (such
            // as smart-tab auto-indent). We explicitly insert the AI text as-is
            // and move the caret to the end of the inserted range. We also
            // commit the PSI so any later listener sees the final document.
            WriteCommandAction.runWriteCommandAction(project, "Snow: Accept Inline Suggestion", null, Runnable {
                editor.document.insertString(offset, text)
                editor.caretModel.moveToOffset(offset + text.length)
                if (project != null) {
                    PsiDocumentManager.getInstance(project).commitDocument(editor.document)
                }
            })
        } finally {
            suppressed = false
        }
        return true
    }

    fun dismiss(): Boolean {
        if (completionText == null) return false
        dismissInlays()
        return true
    }

    fun triggerNow() {
        dismissInlays()
        scheduleRequest()
    }

    private fun scheduleCompletion() {
        cancelPending()
        val ms = config.debounceMs.toLong().coerceAtLeast(100)
        debounceTimer = scheduler.schedule({ scheduleRequest() }, ms, TimeUnit.MILLISECONDS)
    }

    private fun cancelPending() {
        debounceTimer?.cancel(false)
        debounceTimer = null
        currentFuture?.cancel(true)
        currentFuture = null
    }

    private data class CompletionContext(
        val prefix: String,
        val suffix: String,
        val languageId: String,
        val fileName: String,
        val requestOffset: Int,
    )

    private fun scheduleRequest() {
        val cfg = config
        if (!cfg.enabled) return
        if (cfg.apiKey.isBlank()) {
            logger.info("Completion skipped: API Key is empty")
            return
        }
        if (cfg.model.isBlank()) {
            logger.info("Completion skipped: Model is empty")
            return
        }

        val ctx = ApplicationManager.getApplication().runReadAction<CompletionContext?> {
            if (editor.isDisposed) return@runReadAction null
            val vFile = FileDocumentManager.getInstance().getFile(editor.document) ?: return@runReadAction null
            val languageId = vFile.fileType.name.lowercase()
            if (!cfg.isLanguageEnabled(languageId)) {
                logger.info("Completion skipped: language '$languageId' not enabled")
                return@runReadAction null
            }

            val offset = editor.caretModel.offset
            val document = editor.document
            val lineNumber = document.getLineNumber(offset)

            val prefixStartLine = (lineNumber - cfg.contextPrefixLines).coerceAtLeast(0)
            val prefixStartOffset = document.getLineStartOffset(prefixStartLine)
            val prefix = document.getText(TextRange(prefixStartOffset, offset))

            val suffixEndLine = (lineNumber + cfg.contextSuffixLines).coerceAtMost(document.lineCount - 1)
            val suffixEndOffset = document.getLineEndOffset(suffixEndLine)
            val suffix = document.getText(TextRange(offset, suffixEndOffset))

            if (prefix.isBlank() && suffix.isBlank()) return@runReadAction null

            CompletionContext(prefix, suffix, languageId, vFile.name, offset)
        } ?: return

        service.updateStatusBar(editor, loading = true)

        val req = CompletionRequest(ctx.prefix, ctx.suffix, ctx.languageId, ctx.fileName)
        currentFuture = service.submitRequest {
            try {
                logger.info("Requesting completion: provider=${cfg.provider}, model=${cfg.model}, file=${ctx.fileName}")
                val result = SnowCompletionClient.requestCompletion(cfg, req)
                val text = result.text.trimEnd()
                if (text.isEmpty()) {
                    logger.info("Completion returned empty text")
                    ApplicationManager.getApplication().invokeLater {
                        service.updateStatusBar(editor, loading = false)
                    }
                    return@submitRequest
                }

                logger.info("Completion received: ${text.length} chars")
                ApplicationManager.getApplication().invokeLater {
                    if (editor.isDisposed) return@invokeLater
                    service.updateStatusBar(editor, loading = false)
                    if (editor.caretModel.offset != ctx.requestOffset) return@invokeLater
                    if (completionText != null) return@invokeLater
                    showCompletion(text, ctx.requestOffset)
                }
            } catch (e: Exception) {
                if (e is InterruptedException || e is CancellationException) return@submitRequest
                logger.warn("Completion request failed: ${e.message}", e)
                ApplicationManager.getApplication().invokeLater {
                    service.updateStatusBar(editor, loading = false, message = "Error: ${e.message?.take(40)}")
                    scheduler.schedule({
                        ApplicationManager.getApplication().invokeLater {
                            service.updateStatusBar(editor, loading = false, message = null)
                        }
                    }, 5, TimeUnit.SECONDS)
                }
            }
        }
    }

    private fun showCompletion(text: String, offset: Int) {
        completionText = text
        completionOffset = offset

        val lines = text.split('\n')
        val inlays = mutableListOf<Inlay<*>>()

        val firstLine = lines[0]
        if (firstLine.isNotEmpty()) {
            val inlay = editor.inlayModel.addInlineElement(offset, true, SnowInlineRenderer(firstLine))
            if (inlay != null) inlays.add(inlay)
        }

        if (lines.size > 1) {
            val blockLines = lines.subList(1, lines.size)
            val inlay = editor.inlayModel.addBlockElement(
                offset, true, false, 0, SnowBlockRenderer(blockLines)
            )
            if (inlay != null) inlays.add(inlay)
        }

        currentInlays = inlays
        logger.info("Showing ${inlays.size} inlay(s) at offset $offset")
    }

    private fun dismissInlays() {
        cancelPending()
        completionText = null
        completionOffset = -1
        val inlays = currentInlays
        currentInlays = emptyList()
        if (inlays.isNotEmpty()) {
            ApplicationManager.getApplication().invokeLater {
                for (inlay in inlays) {
                    if (inlay.isValid) Disposer.dispose(inlay)
                }
            }
        }
    }

    override fun dispose() {
        dismissInlays()
        scheduler.shutdownNow()
        editor.document.removeDocumentListener(docListener)
        editor.caretModel.removeCaretListener(caretListener)
    }
}
