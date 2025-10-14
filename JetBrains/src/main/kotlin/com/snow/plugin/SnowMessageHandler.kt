package com.snow.plugin

import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.codeInsight.daemon.impl.HighlightInfoType
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiManager
import org.json.JSONObject
import org.json.JSONArray

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

        // Note: Getting diagnostics in IntelliJ requires access to the inspection system
        // This is a simplified version. Full implementation would use DaemonCodeAnalyzer
        return emptyList() // Placeholder - would need inspection integration
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
