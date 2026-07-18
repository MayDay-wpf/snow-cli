package com.snow.plugin.nextEdit

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.*
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.WindowManager
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicInteger

@Service(Service.Level.PROJECT)
class SnowNextEditEngine(private val project: Project) : Disposable {
    private val logger = Logger.getInstance(SnowNextEditEngine::class.java)
    private val config get() = SnowNextEditConfig.getInstance()
    private val tracker = SnowEditTracker(project, config.debounceMs)
    private val finder = SnowCandidateFinder(project)
    private val decoration = SnowNextEditDecoration(project)
    private val executor = Executors.newCachedThreadPool { r ->
        Thread(r, "Snow-NextEdit").apply { isDaemon = true }
    }

    private val registeredDocs: MutableSet<Document> =
        Collections.newSetFromMap(ConcurrentHashMap())

    @Volatile private var session: ActiveSession? = null
    @Volatile private var scanFuture: Future<*>? = null
    @Volatile private var suppressed = false
    @Volatile private var working: Boolean = false
    private val scanGeneration = AtomicInteger(0)

    private data class ActiveSession(
        val edit: RecentEdit,
        val queue: MutableList<Candidate>,
        var current: Candidate,
        var anchorFile: VirtualFile,
        var anchorLine: Int,
    )

    private val docListener = object : DocumentListener {
        override fun documentChanged(event: DocumentEvent) {
            if (suppressed) return
            val s = session ?: return
            val file = FileDocumentManager.getInstance().getFile(event.document) ?: return
            if (file.path != s.anchorFile.path) return
            val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return
            s.anchorLine = editor.caretModel.logicalPosition.line
            redraw()
        }
    }

    private val caretListener = object : CaretListener {
        override fun caretPositionChanged(event: CaretEvent) {
            if (suppressed) return
            val s = session ?: return
            val editor = event.editor
            val file = FileDocumentManager.getInstance().getFile(editor.document) ?: return
            if (file.path != s.anchorFile.path) return
            val newLine = editor.caretModel.logicalPosition.line
            if (kotlin.math.abs(newLine - s.anchorLine) <= 1) {
                s.anchorLine = newLine
                redraw()
            } else {
                dismiss("cursor moved off anchor")
            }
        }
    }

    init {
        logger.info("SnowNextEditEngine initialized for project: ${project.name}")
        tracker.onEdit { edit -> onEdit(edit) }
        tracker.onTyping { onUserTyping() }

        EditorFactory.getInstance().eventMulticaster.addDocumentListener(docListener, this)
        EditorFactory.getInstance().eventMulticaster.addCaretListener(caretListener, this)

        project.messageBus.connect(this).subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun fileOpened(source: FileEditorManager, file: VirtualFile) {
                    // Register tracker for newly opened files so we don't miss edits
                    // on documents that were not open at startup.
                    for (fileEditor in source.getEditors(file)) {
                        val textEditor = fileEditor as? com.intellij.openapi.fileEditor.TextEditor ?: continue
                        registerDocument(textEditor.editor)
                    }
                }

                override fun selectionChanged(event: FileEditorManagerEvent) {
                    val editor = FileEditorManager.getInstance(project).selectedTextEditor
                    if (editor != null) registerDocument(editor)

                    val s = session ?: return
                    if (suppressed) return
                    val newFile = event.newFile
                    if (newFile == null || newFile.path != s.anchorFile.path) {
                        dismiss("active file changed")
                    }
                }
            },
        )
    }

    fun registerDocument(editor: Editor) {
        val doc = editor.document
        if (registeredDocs.add(doc)) {
            doc.addDocumentListener(tracker)
            logger.info("Registered edit tracker for: ${FileDocumentManager.getInstance().getFile(doc)?.name ?: "unknown"}")
        }
        tracker.captureSnapshot(doc)
    }

    fun unregisterDocument(editor: Editor) {
        val doc = editor.document
        if (registeredDocs.remove(doc)) {
            doc.removeDocumentListener(tracker)
        }
        tracker.removeSnapshot(doc)
    }

    fun hasSession(): Boolean = session != null

    fun isWorking(): Boolean = working

    fun hasSessionForEditor(editor: Editor): Boolean {
        val s = session ?: return false
        val file = FileDocumentManager.getInstance().getFile(editor.document) ?: return false
        return file.path == s.anchorFile.path
    }

    fun tryAccept(editor: Editor): Boolean {
        val s = session ?: return false
        val file = FileDocumentManager.getInstance().getFile(editor.document) ?: return false
        if (file.path != s.anchorFile.path) return false

        val target = s.current
        suppressed = true
        tracker.pause(800)

        var landedEditor: Editor? = null
        var landedLine: Int = s.anchorLine
        try {
            ApplicationManager.getApplication().runWriteAction {
                val targetEditor = openFileAndGetEditor(target.file) ?: return@runWriteAction
                val doc = targetEditor.document
                if (target.startOffset <= doc.textLength && target.endOffset <= doc.textLength) {
                    doc.replaceString(target.startOffset, target.endOffset, target.replacement)
                    val endPos = target.startOffset + target.replacement.length
                    targetEditor.caretModel.moveToOffset(endPos)
                    targetEditor.scrollingModel.scrollToCaret(com.intellij.openapi.editor.ScrollType.CENTER_UP)
                    landedEditor = targetEditor
                    landedLine = doc.getLineNumber(endPos)
                }
            }
        } finally {
            suppressed = false
        }

        // Chained Tab support: keep the session alive and re-anchor it at the
        // freshly-landed position so the next Tab continues hopping.
        if (s.queue.isNotEmpty()) {
            val nextCandidate = s.queue.removeAt(0)
            s.current = nextCandidate
            val anchor = landedEditor ?: FileEditorManager.getInstance(project).selectedTextEditor
            if (anchor != null) {
                val newFile = FileDocumentManager.getInstance().getFile(anchor.document)
                if (newFile != null) {
                    s.anchorFile = newFile
                    s.anchorLine = landedLine
                }
            }
            redraw()
            updateStatusBar()
            return true
        }

        // Queue exhausted: nothing more to suggest. Dismiss the session; the next real
        // edit will trigger another AI scan.
        dismiss("queue exhausted")
        return true
    }

    fun tryDismiss(@Suppress("UNUSED_PARAMETER") editor: Editor): Boolean {
        if (session == null) return false
        dismiss("user")
        return true
    }

    fun next() {
        val s = session ?: return
        val next = s.queue.removeFirstOrNull()
        if (next == null) {
            dismiss("queue empty")
            return
        }
        s.current = next
        redraw()
    }

    fun dismiss(reason: String = "user") {
        // Always invalidate any in-flight scan so its late callback does not
        // resurrect a session the user wanted closed (or flip the loading
        // indicator back on after we cleared it).
        scanGeneration.incrementAndGet()
        scanFuture?.cancel(true)
        val hadWork = working
        working = false
        if (session == null) {
            if (hadWork) updateStatusBar()
            return
        }
        logger.info("Session dismissed: $reason")
        session = null
        decoration.clear()
        updateStatusBar()
    }

    /**
     * Called by SnowEditTracker as soon as a (non-suppressed) document change
     * is observed, before the debounce window even starts. Mirrors the inline
     * completion's "dismissInlays + cancelPending" flow: any in-flight scan
     * gets invalidated immediately so the status-bar spinner stops while the
     * user is still typing instead of waiting for the next edit to fire.
     */
    private fun onUserTyping() {
        if (suppressed) return
        // Bumping the generation makes any callback from the previous scan
        // a no-op when it eventually returns from HttpClient.send.
        scanGeneration.incrementAndGet()
        scanFuture?.cancel(true)
        if (working) {
            working = false
            ApplicationManager.getApplication().invokeLater { updateStatusBar() }
        }
    }

    fun triggerManual(editor: Editor) {
        val doc = editor.document
        val sel = editor.selectionModel
        val word = if (sel.hasSelection()) {
            sel.selectedText ?: ""
        } else {
            ApplicationManager.getApplication().runReadAction<String> {
                val offset = editor.caretModel.offset
                val lineStart = doc.getLineStartOffset(doc.getLineNumber(offset))
                val lineEnd = doc.getLineEndOffset(doc.getLineNumber(offset))
                val lineText = doc.getText(TextRange(lineStart, lineEnd))
                val col = offset - lineStart
                extractWordAt(lineText, col)
            }
        }
        if (word.isBlank()) return

        val vFile = FileDocumentManager.getInstance().getFile(doc) ?: return
        val offset = editor.caretModel.offset
        val fakeEdit = RecentEdit(
            file = vFile,
            languageId = vFile.fileType.name.lowercase(),
            oldText = word,
            newText = word,
            newRangeStart = offset - word.length,
            newRangeEnd = offset,
            cursorOffset = offset,
            timestamp = System.currentTimeMillis(),
        )
        onEdit(fakeEdit, manual = true)
    }

    private fun onEdit(edit: RecentEdit, manual: Boolean = false) {
        if (!config.enabled && !manual) {
            logger.info("Snow Next skipped: disabled (manual=$manual)")
            return
        }
        logger.info("Snow Next edit detected: old='${edit.oldText.take(30)}', new='${edit.newText.take(30)}', file=${edit.file.name}, manual=$manual")

        // Bump generation BEFORE cancelling the previous scan so any pending
        // callback from the old run is treated as stale even if it has already
        // crossed the cancel barrier.
        val gen = scanGeneration.incrementAndGet()
        scanFuture?.cancel(true)

        // Flip working immediately and refresh the status bar so the user can
        // tell that Snow Next actually picked up the edit (this is what the
        // "loading" state shows).
        working = true
        ApplicationManager.getApplication().invokeLater { updateStatusBar() }

        scanFuture = executor.submit {
            try {
                logger.info("Snow Next scan started (gen=$gen)")
                val candidates = finder.find(edit, config)
                if (gen != scanGeneration.get()) {
                    logger.info("Snow Next scan stale, dropping result (gen=$gen)")
                    return@submit
                }
                logger.info("Snow Next scan finished (gen=$gen): ${candidates.size} candidate(s)")
                if (candidates.isEmpty()) {
                    ApplicationManager.getApplication().invokeLater {
                        if (gen != scanGeneration.get()) return@invokeLater
                        working = false
                        if (session != null) dismiss("no more candidates")
                        else updateStatusBar()
                    }
                    return@submit
                }

                ApplicationManager.getApplication().invokeLater {
                    if (gen != scanGeneration.get()) return@invokeLater
                    if (project.isDisposed) return@invokeLater
                    val editor = FileEditorManager.getInstance(project).selectedTextEditor
                    if (editor == null) {
                        working = false
                        updateStatusBar()
                        return@invokeLater
                    }
                    val anchorLine = editor.caretModel.logicalPosition.line
                    session = ActiveSession(
                        edit = edit,
                        queue = candidates.drop(1).toMutableList(),
                        current = candidates[0],
                        anchorFile = edit.file,
                        anchorLine = anchorLine,
                    )
                    working = false
                    redraw()
                    updateStatusBar()
                }
            } catch (e: Exception) {
                if (e is InterruptedException) {
                    if (gen == scanGeneration.get()) {
                        ApplicationManager.getApplication().invokeLater {
                            if (gen != scanGeneration.get()) return@invokeLater
                            working = false
                            updateStatusBar()
                        }
                    }
                    return@submit
                }
                logger.warn("Snow Next scan error (gen=$gen): ${e.message}", e)
                ApplicationManager.getApplication().invokeLater {
                    if (gen != scanGeneration.get()) return@invokeLater
                    working = false
                    updateStatusBar()
                }
            }
        }
    }

    private fun redraw() {
        val s = session ?: return
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: run {
            decoration.clear()
            return
        }
        decoration.show(editor, s.anchorLine, s.current, s.queue.size)
    }

    private fun updateStatusBar() {
        val statusBar = WindowManager.getInstance().getStatusBar(project) ?: return
        val widget = statusBar.getWidget(SnowNextEditStatusBarFactory.WIDGET_ID) as? SnowNextEditStatusBarWidget ?: return
        widget.update()
    }

    private fun openFileAndGetEditor(file: VirtualFile): Editor? {
        val fem = FileEditorManager.getInstance(project)
        fem.openFile(file, true)
        return fem.selectedTextEditor?.takeIf {
            FileDocumentManager.getInstance().getFile(it.document)?.path == file.path
        }
    }

    private fun extractWordAt(line: String, col: Int): String {
        if (col >= line.length) return ""
        var start = col
        while (start > 0 && isIdChar(line[start - 1])) start--
        var end = col
        while (end < line.length && isIdChar(line[end])) end++
        return line.substring(start, end)
    }

    private fun isIdChar(c: Char): Boolean = c.isLetterOrDigit() || c == '_' || c == '$'

    override fun dispose() {
        dismiss("engine disposed")
        scanFuture?.cancel(true)
        registeredDocs.clear()
        tracker.dispose()
        decoration.dispose()
        executor.shutdownNow()
    }

    companion object {
        fun getInstance(project: Project): SnowNextEditEngine =
            project.getService(SnowNextEditEngine::class.java)
    }
}
