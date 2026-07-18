package com.snow.plugin.nextEdit

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.vfs.VirtualFile
import java.util.concurrent.ConcurrentHashMap

data class RecentEdit(
    val file: VirtualFile,
    val languageId: String,
    val oldText: String,
    val newText: String,
    val newRangeStart: Int,
    val newRangeEnd: Int,
    val cursorOffset: Int,
    val timestamp: Long,
)

class SnowEditTracker(
    private val project: Project,
    private val quietMs: Int,
    private val maxEditLength: Int = 200,
    private val maxSnapshotBytes: Int = 2_000_000,
) : DocumentListener, Disposable {

    private val logger = Logger.getInstance(SnowEditTracker::class.java)
    private val snapshots = ConcurrentHashMap<Document, String>()
    private val listeners = mutableListOf<(RecentEdit) -> Unit>()
    private val typingListeners = mutableListOf<() -> Unit>()

    @Volatile private var pendingTimer: java.util.Timer? = null
    @Volatile private var pending: PendingBurst? = null
    @Volatile private var pauseUntil: Long = 0

    private data class PendingBurst(
        val document: Document,
        val file: VirtualFile,
        val languageId: String,
        val baseline: String,
    )

    fun onEdit(listener: (RecentEdit) -> Unit) {
        listeners.add(listener)
    }

    /**
     * Fires synchronously on the EDT for every raw documentChanged that is not
     * suppressed by [pause]. The engine uses this to invalidate any in-flight
     * scan immediately so the status-bar spinner stops while the user is still
     * typing (mirrors the inline-completion "dismissInlays + cancelPending"
     * flow).
     */
    fun onTyping(listener: () -> Unit) {
        typingListeners.add(listener)
    }

    fun pause(ms: Long) {
        pauseUntil = (System.currentTimeMillis() + ms).coerceAtLeast(pauseUntil)
        cancelPending()
    }

    fun captureSnapshot(document: Document) {
        val text = document.text
        if (text.length > maxSnapshotBytes) {
            snapshots.remove(document)
            return
        }
        snapshots[document] = text
    }

    fun removeSnapshot(document: Document) {
        snapshots.remove(document)
    }

    override fun documentChanged(event: DocumentEvent) {
        val document = event.document
        val oldSnapshot = snapshots[document]
        val newText = document.text
        snapshots[document] = newText

        if (oldSnapshot == null) return
        if (System.currentTimeMillis() < pauseUntil) {
            cancelPending()
            return
        }

        // Notify the engine that the user is actively typing BEFORE we
        // (re)start the debounce window. This lets the engine immediately
        // cancel any in-flight AI scan so the loading spinner stops while
        // the user is still typing, just like the inline-completion path.
        for (l in typingListeners) {
            try { l() } catch (e: Exception) { logger.warn("Typing listener error: ${e.message}") }
        }

        val vFile = FileDocumentManager.getInstance().getFile(document) ?: return
        val languageId = vFile.fileType.name.lowercase()

        if (pending == null || pending?.document !== document) {
            pending = PendingBurst(document, vFile, languageId, oldSnapshot)
        }

        cancelTimer()
        val timer = java.util.Timer("Snow-EditTracker-Debounce", true)
        timer.schedule(object : java.util.TimerTask() {
            override fun run() { flush() }
        }, quietMs.toLong())
        pendingTimer = timer
    }

    private fun cancelPending() {
        cancelTimer()
        pending = null
    }

    private fun cancelTimer() {
        pendingTimer?.cancel()
        pendingTimer = null
    }

    private fun flush() {
        val p = pending ?: return
        pending = null
        pendingTimer = null

        // CRITICAL: this method is triggered from java.util.Timer's background
        // thread. Any access to Document/Editor/FileEditorManager from there
        // throws "Read access is allowed from inside read-action only" and the
        // exception is silently swallowed by TimerTask, which is why Snow Next
        // was "almost never activated". We must bounce to EDT before touching
        // any IntelliJ model objects.
        ApplicationManager.getApplication().invokeLater {
            flushOnEdt(p)
        }
    }

    private fun flushOnEdt(p: PendingBurst) {
        val event: RecentEdit = ApplicationManager.getApplication().runReadAction<RecentEdit?> {
            if (project.isDisposed) return@runReadAction null
            val current = p.document.text
            val diff = diffByEdges(p.baseline, current) ?: return@runReadAction null
            if (diff.oldText.isBlank() && diff.newText.isBlank()) return@runReadAction null
            if (diff.oldText.length > maxEditLength || diff.newText.length > maxEditLength) {
                logger.info("Edit too large (old=${diff.oldText.length}, new=${diff.newText.length}); ignored")
                return@runReadAction null
            }

            val editor = FileEditorManager.getInstance(project).selectedTextEditor
            val cursorOffset = if (editor != null && FileDocumentManager.getInstance().getFile(editor.document) == p.file) {
                editor.caretModel.offset
            } else {
                diff.start + diff.newText.length
            }

            RecentEdit(
                file = p.file,
                languageId = p.languageId,
                oldText = diff.oldText,
                newText = diff.newText,
                newRangeStart = diff.start,
                newRangeEnd = diff.start + diff.newText.length,
                cursorOffset = cursorOffset,
                timestamp = System.currentTimeMillis(),
            )
        } ?: return

        logger.info("Edit flushed: old='${event.oldText.take(40)}', new='${event.newText.take(40)}', file=${event.file.name}")
        for (l in listeners) {
            try {
                l(event)
            } catch (e: Exception) {
                logger.warn("Edit listener error: ${e.message}")
            }
        }
    }

    override fun dispose() {
        cancelPending()
        snapshots.clear()
        listeners.clear()
        typingListeners.clear()
    }

    companion object {
        data class DiffResult(val start: Int, val oldText: String, val newText: String)

        fun diffByEdges(a: String, b: String): DiffResult? {
            if (a == b) return null
            val aLen = a.length
            val bLen = b.length
            val maxPrefix = minOf(aLen, bLen)

            var prefix = 0
            while (prefix < maxPrefix && a[prefix] == b[prefix]) prefix++

            var suffix = 0
            val maxSuffix = minOf(aLen - prefix, bLen - prefix)
            while (suffix < maxSuffix && a[aLen - 1 - suffix] == b[bLen - 1 - suffix]) suffix++

            val oldText = a.substring(prefix, aLen - suffix)
            val newText = b.substring(prefix, bLen - suffix)
            if (oldText.isEmpty() && newText.isEmpty()) return null
            return DiffResult(prefix, oldText, newText)
        }
    }
}
