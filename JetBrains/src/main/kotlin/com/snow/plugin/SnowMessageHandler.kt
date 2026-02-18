package com.snow.plugin

import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.codeInsight.daemon.impl.HighlightInfoType
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.chains.SimpleDiffRequestChain
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiManager
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

/**
 * Handles incoming messages from Snow CLI
 */
class SnowMessageHandler(private val project: Project) {
    private val logger = Logger.getInstance(SnowMessageHandler::class.java)
    private val wsManager = SnowWebSocketManager.instance
    private val codeNavigator = SnowCodeNavigator(project)

    init {
        wsManager.setMessageHandler { message -> handleMessage(message) }
    }

    /**
     * Handle incoming WebSocket message
     */
    private fun handleMessage(message: String) {
        try {
            val json = JSONObject(message)
            val type = json.optString("type")

            when (type) {
                "getDiagnostics" -> handleGetDiagnostics(json)
                "aceGoToDefinition" -> handleGoToDefinition(json)
                "aceFindReferences" -> handleFindReferences(json)
                "aceGetSymbols" -> handleGetSymbols(json)
                "showDiff" -> handleShowDiff(json)
                "showDiffReview" -> handleShowDiffReview(json)
                "showGitDiff" -> handleShowGitDiff(json)
                "closeDiff" -> handleCloseDiff()
                else -> logger.info("Unknown message type: $type")
            }
        } catch (e: Exception) {
            logger.warn("Failed to handle message", e)
        }
    }

    /**
     * Handle getDiagnostics request
     */
    private fun handleGetDiagnostics(json: JSONObject) {
        val filePath = json.optString("filePath")
        val requestId = json.optString("requestId")

        ApplicationManager.getApplication().runReadAction {
            try {
                val file = VirtualFileManager.getInstance().findFileByUrl("file://$filePath")
                val diagnostics = if (file != null) {
                    getDiagnostics(file)
                } else {
                    emptyList()
                }

                val response = mapOf(
                    "type" to "diagnostics",
                    "requestId" to requestId,
                    "diagnostics" to diagnostics
                )
                wsManager.sendMessage(response)
            } catch (e: Exception) {
                logger.warn("Failed to get diagnostics", e)
                sendEmptyResponse("diagnostics", requestId)
            }
        }
    }

    /**
     * Get diagnostics for a file
     */
    private fun getDiagnostics(file: VirtualFile): List<Map<String, Any?>> {
        val psiFile = PsiManager.getInstance(project).findFile(file) ?: return emptyList()
        val document = PsiDocumentManager.getInstance(project).getDocument(psiFile) ?: return emptyList()

        return try {
            val highlightInfos = mutableListOf<Map<String, Any?>>()

            // Wrap in read action to ensure thread safety
            ApplicationManager.getApplication().runReadAction {
                try {
                    // Use DocumentMarkupModel to get all highlight infos safely
                    val markupModel = com.intellij.openapi.editor.impl.DocumentMarkupModel.forDocument(document, project, true)
                    if (markupModel != null) {
                        // Process all highlighters
                        markupModel.allHighlighters.forEach { highlighter ->
                            try {
                                // Get HighlightInfo from the highlighter's error stripe tooltip
                                val errorStripeTooltip = highlighter.errorStripeTooltip

                                // Try to extract info from different tooltip types
                                if (errorStripeTooltip is HighlightInfo) {
                                    val info = errorStripeTooltip
                                    val severity = info.severity

                                    // Skip if severity is too low (e.g., just syntax highlighting)
                                    if (severity.myVal <= HighlightSeverity.INFORMATION.myVal) {
                                        return@forEach
                                    }

                                    val startOffset = info.startOffset
                                    val line = document.getLineNumber(startOffset)
                                    val lineStartOffset = document.getLineStartOffset(line)
                                    val character = startOffset - lineStartOffset

                                    highlightInfos.add(mapOf(
                                        "message" to (info.description ?: "Unknown issue"),
                                        "severity" to when {
                                            severity == HighlightSeverity.ERROR -> "error"
                                            severity == HighlightSeverity.WARNING -> "warning"
                                            severity == HighlightSeverity.WEAK_WARNING -> "info"
                                            else -> "hint"
                                        },
                                        "line" to line,
                                        "character" to character,
                                        "source" to "IntelliJ",
                                        "code" to (info.inspectionToolId ?: "")
                                    ))
                                }
                            } catch (e: Exception) {
                                // Silently skip this highlighter if we can't process it
                                logger.debug("Failed to process highlighter", e)
                            }
                        }
                    }
                } catch (e: Exception) {
                    logger.warn("Failed to extract diagnostics from markup model", e)
                }
            }

            highlightInfos
        } catch (e: Exception) {
            logger.warn("Failed to get diagnostics", e)
            emptyList()
        }
    }

    /**
     * Handle aceGoToDefinition request
     */
    private fun handleGoToDefinition(json: JSONObject) {
        val filePath = json.optString("filePath")
        val line = json.optInt("line")
        val column = json.optInt("column")
        val requestId = json.optString("requestId")

        ApplicationManager.getApplication().runReadAction {
            try {
                val definitions = codeNavigator.goToDefinition(filePath, line, column)
                val response = mapOf(
                    "type" to "aceGoToDefinitionResult",
                    "requestId" to requestId,
                    "definitions" to definitions
                )
                wsManager.sendMessage(response)
            } catch (e: Exception) {
                logger.warn("Failed to go to definition", e)
                sendEmptyResponse("aceGoToDefinitionResult", requestId, "definitions")
            }
        }
    }

    /**
     * Handle aceFindReferences request
     */
    private fun handleFindReferences(json: JSONObject) {
        val filePath = json.optString("filePath")
        val line = json.optInt("line")
        val column = json.optInt("column")
        val requestId = json.optString("requestId")

        ApplicationManager.getApplication().runReadAction {
            try {
                val references = codeNavigator.findReferences(filePath, line, column)
                val response = mapOf(
                    "type" to "aceFindReferencesResult",
                    "requestId" to requestId,
                    "references" to references
                )
                wsManager.sendMessage(response)
            } catch (e: Exception) {
                logger.warn("Failed to find references", e)
                sendEmptyResponse("aceFindReferencesResult", requestId, "references")
            }
        }
    }

    /**
     * Handle aceGetSymbols request
     */
    private fun handleGetSymbols(json: JSONObject) {
        val filePath = json.optString("filePath")
        val requestId = json.optString("requestId")

        ApplicationManager.getApplication().runReadAction {
            try {
                val symbols = codeNavigator.getSymbols(filePath)
                val response = mapOf(
                    "type" to "aceGetSymbolsResult",
                    "requestId" to requestId,
                    "symbols" to symbols
                )
                wsManager.sendMessage(response)
            } catch (e: Exception) {
                logger.warn("Failed to get symbols", e)
                sendEmptyResponse("aceGetSymbolsResult", requestId, "symbols")
            }
        }
    }

    @Volatile
    private var trackedDiffFiles = mutableListOf<VirtualFile>()

    private fun closeTrackedDiffs() {
        if (project.isDisposed) return
        val fem = FileEditorManager.getInstance(project)
        val toClose = trackedDiffFiles.toList()
        trackedDiffFiles.clear()
        for (file in toClose) {
            if (file.isValid) {
                fem.closeFile(file)
            }
        }
    }

    private fun showDiffInEditor(title: String, leftText: String, rightText: String, leftLabel: String, rightLabel: String, fileName: String) {
        if (project.isDisposed) return

        val fem = FileEditorManager.getInstance(project)
        val beforeFiles = fem.openFiles.toSet()

        closeTrackedDiffs()

        val fileType = FileTypeManager.getInstance().getFileTypeByFileName(fileName)
        val contentFactory = DiffContentFactory.getInstance()
        val left = contentFactory.create(leftText, fileType)
        val right = contentFactory.create(rightText, fileType)
        val request = SimpleDiffRequest(title, left, right, leftLabel, rightLabel)
        DiffManager.getInstance().showDiff(project, request)

        val afterFiles = fem.openFiles.toSet()
        val newFiles = afterFiles - beforeFiles
        trackedDiffFiles.addAll(newFiles)

        restoreTerminalFocus()
    }

    private fun handleCloseDiff() {
        ApplicationManager.getApplication().invokeLater({
            closeTrackedDiffs()
        }, ModalityState.defaultModalityState())
    }

    private fun restoreTerminalFocus() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            ToolWindowManager.getInstance(project).getToolWindow("Terminal")?.activate(null, false, false)
        }
    }

    private fun notifyError(message: String) {
        try {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Snow CLI")
                .createNotification(message, NotificationType.ERROR)
                .notify(project)
        } catch (e: Exception) {
            logger.warn("Failed to show notification: $message", e)
        }
    }

    private fun handleShowDiff(json: JSONObject) {
        val filePath = json.optString("filePath", "")
        val originalContent = json.optString("originalContent", "")
        val newContent = json.optString("newContent", "")
        val label = json.optString("label", "Diff")

        if (filePath.isEmpty()) {
            logger.warn("showDiff: filePath is empty")
            return
        }

        val fileName = File(filePath).name

        ApplicationManager.getApplication().invokeLater({
            try {
                showDiffInEditor("$label: $fileName", originalContent, newContent, "Original", "Current", fileName)
            } catch (e: Exception) {
                logger.error("Failed to show diff for $filePath", e)
                notifyError("Snow CLI: Failed to show diff - ${e.message}")
            }
        }, ModalityState.defaultModalityState())
    }

    private fun handleShowDiffReview(json: JSONObject) {
        val filesArray = json.optJSONArray("files")
        if (filesArray == null || filesArray.length() == 0) {
            logger.warn("showDiffReview: no files")
            return
        }

        data class DiffItem(val title: String, val left: String, val right: String, val fileName: String)

        val items = mutableListOf<DiffItem>()
        for (i in 0 until filesArray.length()) {
            try {
                val fileObj = filesArray.getJSONObject(i)
                val filePath = fileObj.optString("filePath", "")
                val originalContent = fileObj.optString("originalContent", "")
                val newContent = fileObj.optString("newContent", "")
                val fileName = File(filePath).name
                items.add(DiffItem("Diff Review: $fileName", originalContent, newContent, fileName))
            } catch (e: Exception) {
                logger.warn("showDiffReview: failed to parse file $i", e)
            }
        }

        if (items.isEmpty()) return

        ApplicationManager.getApplication().invokeLater({
            try {
                if (project.isDisposed) return@invokeLater

                val fem = FileEditorManager.getInstance(project)
                val beforeFiles = fem.openFiles.toSet()

                closeTrackedDiffs()

                if (items.size == 1) {
                    val item = items[0]
                    val fileType = FileTypeManager.getInstance().getFileTypeByFileName(item.fileName)
                    val contentFactory = DiffContentFactory.getInstance()
                    val left = contentFactory.create(item.left, fileType)
                    val right = contentFactory.create(item.right, fileType)
                    val request = SimpleDiffRequest(item.title, left, right, "Original", "Current")
                    DiffManager.getInstance().showDiff(project, request)
                } else {
                    val contentFactory = DiffContentFactory.getInstance()
                    val requests = items.map { item ->
                        val fileType = FileTypeManager.getInstance().getFileTypeByFileName(item.fileName)
                        val left = contentFactory.create(item.left, fileType)
                        val right = contentFactory.create(item.right, fileType)
                        SimpleDiffRequest(item.title, left, right, "Original", "Current")
                    }
                    val chain = SimpleDiffRequestChain(requests)
                    DiffManager.getInstance().showDiff(project, chain, com.intellij.diff.DiffDialogHints.DEFAULT)
                }

                val afterFiles = fem.openFiles.toSet()
                trackedDiffFiles.addAll(afterFiles - beforeFiles)
                restoreTerminalFocus()
            } catch (e: Exception) {
                logger.error("Failed to show diff review", e)
                notifyError("Snow CLI: Failed to show diff review - ${e.message}")
            }
        }, ModalityState.defaultModalityState())
    }

    private fun handleShowGitDiff(json: JSONObject) {
        val filePath = json.optString("filePath", "")
        if (filePath.isEmpty()) return

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val file = File(filePath)
                val repoRoot = project.basePath ?: return@executeOnPooledThread
                val relPath = File(repoRoot).toPath().relativize(file.toPath()).toString().replace('\\', '/')

                val currentContent = if (file.exists()) file.readText() else ""

                var originalContent = ""
                try {
                    val process = ProcessBuilder("git", "show", "HEAD:$relPath")
                        .directory(File(repoRoot))
                        .redirectErrorStream(false)
                        .start()
                    originalContent = process.inputStream.bufferedReader().readText()
                    process.waitFor()
                } catch (_: Exception) {
                    // New/untracked file
                }

                val fileName = file.name

                ApplicationManager.getApplication().invokeLater({
                    try {
                        showDiffInEditor("Git Diff: $fileName", originalContent, currentContent, "HEAD", "Working Tree", fileName)
                    } catch (e: Exception) {
                        logger.error("Failed to show git diff for $filePath", e)
                        notifyError("Snow CLI: Failed to show git diff - ${e.message}")
                    }
                }, ModalityState.defaultModalityState())
            } catch (e: Exception) {
                logger.error("Failed to show git diff for $filePath", e)
            }
        }
    }

    /**
     * Send empty response on error
     */
    private fun sendEmptyResponse(type: String, requestId: String, arrayField: String = "diagnostics") {
        val response = mapOf(
            "type" to type,
            "requestId" to requestId,
            arrayField to emptyList<Any>()
        )
        wsManager.sendMessage(response)
    }
}
