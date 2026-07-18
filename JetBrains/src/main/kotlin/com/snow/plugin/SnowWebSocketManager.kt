package com.snow.plugin

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

/**
 * Manages WebSocket server for Snow CLI connections
 */
class SnowWebSocketManager private constructor() {
    private val logger = Logger.getInstance(SnowWebSocketManager::class.java)
    private val server = AtomicReference<WebSocketServerImpl?>(null)
    private val messageHandler = AtomicReference<((String) -> Unit)?>(null)
    private val clients = ConcurrentHashMap.newKeySet<WebSocket>()

    // Cache for last valid editor context
    @Volatile
    private var lastValidContext: Map<String, Any?>? = null

    companion object {
        // Use different port range from VSCode (9527-9537) to avoid conflicts
        private const val BASE_PORT = 9538
        private const val MAX_PORT = 9548

        val instance: SnowWebSocketManager by lazy { SnowWebSocketManager() }

        /**
         * Normalize path for cross-platform compatibility
         * - Converts Windows backslashes to forward slashes
         * - Converts drive letters to lowercase for consistent comparison
         */
        private fun normalizePath(path: String?): String? {
            if (path == null) return null
            var normalized = path.replace('\\', '/')
            // Convert Windows drive letter to lowercase (C: -> c:)
            if (normalized.matches(Regex("^[A-Z]:.*"))) {
                normalized = normalized[0].lowercaseChar() + normalized.substring(1)
            }
            return normalized
        }
    }

    @Volatile
    private var actualPort = BASE_PORT

    /**
     * Start WebSocket server
     */
    fun connect() {
        if (server.get() != null) {
            return
        }

        ApplicationManager.getApplication().executeOnPooledThread {
            tryStartServer(BASE_PORT)
        }
    }

    /**
     * Try to start server on a specific port, with fallback to next port
     */
    private fun tryStartServer(port: Int) {
        if (port > MAX_PORT) {
            logger.error("Failed to start WebSocket server: all ports $BASE_PORT-$MAX_PORT are in use")
            return
        }

        // Synchronously probe whether the port is actually free before handing it
        // to Java-WebSocket. Java-WebSocket's start() is asynchronous: when another
        // process (e.g. another JetBrains IDE) already holds the port, the bind
        // failure surfaces only inside the server thread via onError, AFTER we have
        // already cached actualPort and registered the project under the wrong port
        // in snow-cli-ports.json. That mismatch is what causes the CLI to attach
        // to the WRONG IDE when two JetBrains IDEs are open simultaneously
        // (showing one IDE's active file with another IDE's working directory).
        if (!isPortAvailable(port)) {
            tryStartServer(port + 1)
            return
        }

        try {
            val wsServer = WebSocketServerImpl(InetSocketAddress(port))
            server.set(wsServer)

            try {
                wsServer.start()
                actualPort = port

                // Server is ready — register all currently open projects
                for (openProject in com.intellij.openapi.project.ProjectManager.getInstance().openProjects) {
                    if (!openProject.isDefault) {
                        writePortInfo(port, openProject)
                    }
                }
            } catch (e: Exception) {
                if (e.message?.contains("Address already in use") == true) {
                    server.set(null)
                    tryStartServer(port + 1)
                } else {
                    logger.error("Failed to start WebSocket server on port $port", e)
                    server.set(null)
                }
            }
        } catch (e: Exception) {
            logger.error("Failed to create WebSocket server on port $port", e)
            tryStartServer(port + 1)
        }
    }

    /**
     * Test whether a TCP port can be bound on localhost. Used to avoid the
     * Java-WebSocket async-bind race: if another IDE already owns the port,
     * binding here fails immediately and we move on to the next port.
     *
     * Note: there is an inherent (microscopic) TOCTOU window between the probe
     * and the actual WebSocketServer bind. The async catch path above still
     * handles that fallback for completeness.
     */
    private fun isPortAvailable(port: Int): Boolean {
        return try {
            ServerSocket().use { socket ->
                socket.reuseAddress = false
                socket.bind(InetSocketAddress("0.0.0.0", port))
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Write port information to temp file for a specific project.
     * Skips writing if the workspace path is empty to avoid
     * an entry that matches every cwd.
     */
    private fun writePortInfo(port: Int, project: com.intellij.openapi.project.Project? = null) {
        try {
            val tmpDir = System.getProperty("java.io.tmpdir")
            val portInfoFile = java.io.File(tmpDir, "snow-cli-ports.json")

            val portInfo = if (portInfoFile.exists()) {
                org.json.JSONObject(portInfoFile.readText())
            } else {
                org.json.JSONObject()
            }

            val resolvedProject = project
                ?: com.intellij.openapi.project.ProjectManager.getInstance().openProjects
                    .firstOrNull { !it.isDefault }
            val workspaceFolder = normalizePath(resolvedProject?.basePath)

            if (workspaceFolder.isNullOrEmpty()) return

            // Remove stale empty-key entry if present
            if (portInfo.has("")) {
                portInfo.remove("")
            }

            val entry = org.json.JSONObject()
            entry.put("port", port)
            entry.put("ide", "JetBrains")
            portInfo.put(workspaceFolder, entry)
            portInfoFile.writeText(portInfo.toString(2))
        } catch (e: Exception) {
            logger.warn("Failed to write port info", e)
        }
    }

    /**
     * Register a project's workspace in the port info file.
     * Called when a project finishes initialisation.
     */
    fun updatePortInfoForProject(project: com.intellij.openapi.project.Project) {
        if (server.get() == null) return
        writePortInfo(actualPort, project)
    }

    /**
     * Stop WebSocket server
     */
    fun disconnect() {
        server.getAndSet(null)?.let { wsServer ->
            try {
                wsServer.stop()
                clients.clear()

                // Clean up port info file
                cleanupPortInfo()
            } catch (e: Exception) {
                logger.error("Error stopping WebSocket server", e)
            }
        }
    }

    /**
     * Clean up port information from temp file
     */
    private fun cleanupPortInfo(project: com.intellij.openapi.project.Project? = null) {
        try {
            val tmpDir = System.getProperty("java.io.tmpdir")
            val portInfoFile = java.io.File(tmpDir, "snow-cli-ports.json")

            if (portInfoFile.exists()) {
                val portInfo = org.json.JSONObject(portInfoFile.readText())

                val resolvedProject = project
                    ?: com.intellij.openapi.project.ProjectManager.getInstance().openProjects
                        .firstOrNull { !it.isDefault }
                val workspaceFolder = normalizePath(resolvedProject?.basePath)

                // Remove the workspace entry
                if (!workspaceFolder.isNullOrEmpty()) {
                    portInfo.remove(workspaceFolder)
                }
                // Always remove stale empty-key entry
                if (portInfo.has("")) {
                    portInfo.remove("")
                }

                if (portInfo.length() == 0) {
                    portInfoFile.delete()
                } else {
                    portInfoFile.writeText(portInfo.toString(2))
                }
            }
        } catch (e: Exception) {
            logger.warn("Failed to clean up port info", e)
        }
    }

    /**
     * Remove a project's workspace from the port info file.
     * Called when a project is closed.
     */
    fun cleanupPortInfoForProject(project: com.intellij.openapi.project.Project) {
        cleanupPortInfo(project)
    }

    /**
     * Send message through WebSocket to all connected clients
     */
    fun sendMessage(data: Map<String, Any?>) {
        if (clients.isEmpty()) {
            return
        }

        try {
            val json = buildJsonString(data)

            // Cache context messages
            if (data["type"] == "context") {
                lastValidContext = data
            }

            // Broadcast to all connected clients
            for (client in clients) {
                if (client.isOpen) {
                    client.send(json)
                }
            }
        } catch (e: Exception) {
            logger.warn("Failed to send message", e)
        }
    }

    /**
     * Set message handler
     */
    fun setMessageHandler(handler: (String) -> Unit) {
        messageHandler.set(handler)
    }

    /**
     * Send editor context for a specific project
     */
    private fun sendEditorContextForProject(project: com.intellij.openapi.project.Project) {
        ApplicationManager.getApplication().runReadAction {
            try {
                val editor = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).selectedTextEditor
                val virtualFile = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).selectedFiles.firstOrNull()

                val context = mutableMapOf<String, Any?>(
                    "type" to "context"
                )

                // Add workspace folder - normalize path for Windows compatibility
                project.basePath?.let { context["workspaceFolder"] = normalizePath(it) }

                // Add active file - normalize path for Windows compatibility
                virtualFile?.path?.let { context["activeFile"] = normalizePath(it) }

                // Add cursor position if editor available
                if (editor != null) {
                    val caretModel = editor.caretModel
                    val position = mapOf(
                        "line" to caretModel.logicalPosition.line,
                        "character" to caretModel.logicalPosition.column
                    )
                    context["cursorPosition"] = position

                    // Add selected text
                    val selectionModel = editor.selectionModel
                    if (selectionModel.hasSelection()) {
                        context["selectedText"] = selectionModel.selectedText
                    }
                }

                sendMessage(context)
            } catch (e: Exception) {
                logger.warn("Failed to build editor context for project ${project.name}", e)
            }
        }
    }

    /**
     * Inner WebSocket server implementation
     */
    private inner class WebSocketServerImpl(address: InetSocketAddress) : WebSocketServer(address) {
        init {
            connectionLostTimeout = 0
        }

        override fun onOpen(conn: WebSocket, handshake: ClientHandshake?) {
            clients.add(conn)

            // Always send current context on new connection
            // This ensures CLI always receives the latest editor state
            ApplicationManager.getApplication().invokeLater {
                val projects = com.intellij.openapi.project.ProjectManager.getInstance().openProjects
                for (project in projects) {
                    try {
                        sendEditorContextForProject(project)
                    } catch (e: Exception) {
                        logger.warn("Failed to send context for project ${project.name}", e)
                    }
                }
            }

            // Also send cached context immediately if available (fast path)
            lastValidContext?.let { context ->
                try {
                    val json = buildJsonString(context)
                    conn.send(json)
                } catch (e: Exception) {
                    logger.warn("Failed to send cached context", e)
                }
            }
        }

        override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
            clients.remove(conn)
        }

        override fun onMessage(conn: WebSocket, message: String) {
            messageHandler.get()?.invoke(message)
        }

        override fun onError(conn: WebSocket?, ex: Exception) {
            logger.warn("WebSocket error", ex)
            conn?.let { clients.remove(it) }
        }

        override fun onStart() {
            // WebSocket server started
        }
    }

    /**
     * Simple JSON string builder (avoiding external dependencies)
     */
    private fun buildJsonString(data: Map<String, Any?>): String {
        val entries = data.entries.joinToString(",") { (key, value) ->
            val valueStr = when (value) {
                null -> "null"
                is String -> "\"${escapeJson(value)}\""
                is Number -> value.toString()
                is Boolean -> value.toString()
                is Map<*, *> -> buildJsonString(value as Map<String, Any?>)
                is List<*> -> buildJsonArray(value)
                else -> "\"${escapeJson(value.toString())}\""
            }
            "\"$key\":$valueStr"
        }
        return "{$entries}"
    }

    private fun buildJsonArray(list: List<*>): String {
        val items = list.joinToString(",") { item ->
            when (item) {
                null -> "null"
                is String -> "\"${escapeJson(item)}\""
                is Number -> item.toString()
                is Boolean -> item.toString()
                is Map<*, *> -> buildJsonString(item as Map<String, Any?>)
                is List<*> -> buildJsonArray(item)
                else -> "\"${escapeJson(item.toString())}\""
            }
        }
        return "[$items]"
    }

    private fun escapeJson(str: String): String {
        return str
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }
}
