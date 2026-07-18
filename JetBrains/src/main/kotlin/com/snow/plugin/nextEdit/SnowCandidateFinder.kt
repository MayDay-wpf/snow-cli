package com.snow.plugin.nextEdit

import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.impl.DocumentMarkupModel
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectFileIndex
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiManager
import com.snow.plugin.completion.SnowCompletionConfig
import kotlin.math.abs

enum class CandidateMode { REPLACE }

data class Candidate(
    val file: VirtualFile,
    val startOffset: Int,
    val endOffset: Int,
    val mode: CandidateMode,
    val replacement: String,
    val preview: String,
    val source: String,
    val reason: String,
)

class SnowCandidateFinder(private val project: Project) {
    private val logger = Logger.getInstance(SnowCandidateFinder::class.java)

    /**
     * Find next-edit candidates by asking the AI.
     *
     * IMPORTANT: This method performs a synchronous HTTP call inside, so it MUST NOT be invoked
     * on the EDT or inside a read action. Call it from a background thread (e.g. an executor).
     * The function will acquire its own short read actions when it needs to touch IntelliJ
     * model objects (Document / VirtualFile / PsiManager).
     */
    fun find(edit: RecentEdit, config: SnowNextEditConfig): List<Candidate> {
        val completionConfig = SnowCompletionConfig.getInstance()

        // Step 1: collect context inside a read action (current file content + candidate workspace files).
        val ctx = ApplicationManager.getApplication().runReadAction<AiContext?> {
            if (project.isDisposed) return@runReadAction null
            buildAiContext(edit, config)
        } ?: return emptyList()

        // Step 2: HTTP call to AI (outside read action, on this background thread).
        val aiCandidates = SnowNextEditClient.requestCandidates(
            completionConfig,
            NextEditAiRequest(
                editFile = ctx.editFilePath,
                editOldText = edit.oldText,
                editNewText = edit.newText,
                editLine = ctx.editLine,
                currentFilePath = ctx.editFilePath,
                currentLanguageId = edit.languageId,
                currentFileContent = ctx.currentFileContent,
                currentFileDiagnostics = ctx.currentFileDiagnostics,
                workspaceFiles = ctx.workspaceFiles,
            ),
        )
        if (aiCandidates.isEmpty()) {
            logger.info("AI returned no Next Edit candidates")
            return emptyList()
        }

        // Step 3: resolve AI candidates back to concrete (file, offset, range) Candidates.
        return ApplicationManager.getApplication().runReadAction<List<Candidate>> {
            if (project.isDisposed) return@runReadAction emptyList()
            resolveCandidates(edit, aiCandidates, config)
        }
    }

    // -- context collection --------------------------------------------------

    private data class AiContext(
        val editFilePath: String,
        val editLine: Int,
        val currentFileContent: String,
        val currentFileDiagnostics: List<DiagnosticHint>,
        val workspaceFiles: List<WorkspaceFileContext>,
    )

    private fun buildAiContext(edit: RecentEdit, config: SnowNextEditConfig): AiContext? {
        val psiFile = PsiManager.getInstance(project).findFile(edit.file) ?: return null
        val document = PsiDocumentManager.getInstance(project).getDocument(psiFile) ?: return null
        val text = document.text
        if (text.length > 2_000_000) return null
        val editLine = document.getLineNumber(edit.newRangeStart.coerceAtMost(document.textLength.coerceAtLeast(0)))
        val currentFileNumbered = numberLines(text)
        val currentFileDiagnostics = collectDiagnostics(document)

        val workspaceFiles = if (config.scope == "workspace") {
            collectWorkspaceFiles(edit)
        } else {
            emptyList()
        }

        return AiContext(
            editFilePath = edit.file.path,
            editLine = editLine,
            currentFileContent = currentFileNumbered,
            currentFileDiagnostics = currentFileDiagnostics,
            workspaceFiles = workspaceFiles,
        )
    }

    private fun collectWorkspaceFiles(edit: RecentEdit): List<WorkspaceFileContext> {
        val identifiers = extractIdentifiers(edit.oldText) + extractIdentifiers(edit.newText)
        val ids = identifiers.toSet()
        if (ids.isEmpty()) return emptyList()

        val result = mutableListOf<WorkspaceFileContext>()
        var totalBytes = 0
        val maxFiles = 8
        val maxTotalBytes = 100_000

        val fileIndex = ProjectFileIndex.getInstance(project)
        fileIndex.iterateContent { vFile ->
            if (result.size >= maxFiles) return@iterateContent false
            if (totalBytes >= maxTotalBytes) return@iterateContent false
            if (vFile.isDirectory) return@iterateContent true
            if (vFile.path == edit.file.path) return@iterateContent true
            if (vFile.length > 2_000_000) return@iterateContent true
            val p = vFile.path
            if (p.contains("/node_modules/") || p.contains("/dist/") ||
                p.contains("/.git/") || p.contains("/build/") ||
                p.contains("/.next/") || p.contains("/coverage/") ||
                p.contains("/out/")
            ) return@iterateContent true

            val psiFile = PsiManager.getInstance(project).findFile(vFile) ?: return@iterateContent true
            val doc = PsiDocumentManager.getInstance(project).getDocument(psiFile) ?: return@iterateContent true
            val content = doc.text
            if (content.length > 200_000) return@iterateContent true

            val hit = ids.any { id ->
                content.contains(id)
            }
            if (!hit) return@iterateContent true

            val numbered = numberLines(content)
            if (totalBytes + numbered.length > maxTotalBytes) return@iterateContent true
            val diagnostics = collectDiagnostics(doc)
            result.add(WorkspaceFileContext(path = vFile.path, content = numbered, diagnostics = diagnostics))
            totalBytes += numbered.length
            true
        }
        return result
    }

    private fun numberLines(text: String): String {
        if (text.isEmpty()) return ""
        val lines = text.split("\n")
        val width = lines.size.toString().length
        val sb = StringBuilder(text.length + lines.size * (width + 3))
        for ((i, line) in lines.withIndex()) {
            val lineNo = (i + 1).toString().padStart(width, ' ')
            sb.append(lineNo).append(": ").append(line)
            if (i != lines.lastIndex) sb.append('\n')
        }
        return sb.toString()
    }

    private fun collectDiagnostics(document: Document): List<DiagnosticHint> {
        val markupModel = DocumentMarkupModel.forDocument(document, project, false) ?: return emptyList()
        val out = mutableListOf<DiagnosticHint>()
        for (highlighter in markupModel.allHighlighters) {
            val info = HighlightInfo.fromRangeHighlighter(highlighter) ?: continue
            val severity = info.severity
            val sev = when {
                severity == HighlightSeverity.ERROR -> "error"
                severity == HighlightSeverity.WARNING -> "warning"
                else -> continue
            }
            val startOffset = info.startOffset
            if (startOffset < 0 || startOffset > document.textLength) continue
            val line = document.getLineNumber(startOffset) + 1
            val column = startOffset - document.getLineStartOffset(line - 1) + 1
            val rawMessage = info.description ?: info.toolTip ?: ""
            val message = rawMessage
                .replace(Regex("<[^>]+>"), "")
                .replace("&nbsp;", " ")
                .trim()
                .take(200)
            if (message.isBlank()) continue
            out.add(
                DiagnosticHint(
                    line = line,
                    column = column,
                    severity = sev,
                    message = message,
                    source = "inspection",
                    code = null,
                ),
            )
            if (out.size >= 30) break
        }
        return out.sortedWith(
            compareByDescending<DiagnosticHint> { it.severity == "error" }.thenBy { it.line },
        )
    }


    // -- candidate resolution ------------------------------------------------

    private fun resolveCandidates(
        edit: RecentEdit,
        ai: List<NextEditAiCandidate>,
        config: SnowNextEditConfig,
    ): List<Candidate> {
        val seen = mutableSetOf<String>()
        val out = mutableListOf<Candidate>()

        for (item in ai) {
            val vFile = resolveVirtualFile(item.file) ?: continue
            if (config.scope == "file" && vFile.path != edit.file.path) continue

            val psiFile = PsiManager.getInstance(project).findFile(vFile) ?: continue
            val doc = PsiDocumentManager.getInstance(project).getDocument(psiFile) ?: continue
            val text = doc.text
            val idx = text.indexOf(item.oldText)
            if (idx < 0) {
                logger.info("AI candidate oldText not found in ${vFile.path}: '${item.oldText.take(60)}'")
                continue
            }
            val startOffset = idx
            val endOffset = idx + item.oldText.length

            // Skip the edit region itself.
            if (vFile.path == edit.file.path) {
                val overlaps = !(endOffset <= edit.newRangeStart || startOffset >= edit.newRangeEnd)
                if (overlaps) continue
            }

            val key = "${vFile.path}::$startOffset:$endOffset"
            if (!seen.add(key)) continue

            val lineNum = doc.getLineNumber(startOffset)
            val lineStart = doc.getLineStartOffset(lineNum)
            val lineEnd = doc.getLineEndOffset(lineNum)
            val previewLine = text.substring(lineStart, lineEnd).trim()
            val preview = previewLine.take(MAX_PREVIEW)

            out.add(
                Candidate(
                    file = vFile,
                    startOffset = startOffset,
                    endOffset = endOffset,
                    mode = CandidateMode.REPLACE,
                    replacement = item.newText,
                    preview = preview,
                    source = "ai",
                    reason = item.reason,
                ),
            )
        }

        out.sortBy { rank(it, edit) }
        return out.take(config.maxCandidates)
    }

    private fun resolveVirtualFile(filePath: String): VirtualFile? {
        if (filePath.isBlank()) return null
        val lfs = LocalFileSystem.getInstance()
        // Absolute path first
        val direct = lfs.findFileByPath(filePath)
        if (direct != null) return direct
        // Try relative to project base path
        val base = project.basePath ?: return null
        val combined = if (filePath.startsWith("/")) "$base$filePath" else "$base/$filePath"
        val rel = lfs.findFileByPath(combined)
        if (rel != null) return rel
        // Try just the file name match through project file index as last resort
        return null
    }

    private fun rank(c: Candidate, edit: RecentEdit): Int {
        val sameFile = if (c.file.path == edit.file.path) 0 else 1
        val lineDelta = if (sameFile == 0) abs(c.startOffset - edit.newRangeStart) else 100_000
        return sameFile * 1_000_000 + lineDelta
    }

    companion object {
        private const val MAX_PREVIEW = 80
        private val IDENTIFIER_RE = Regex("[A-Za-z_$][\\w$]*")
        private val STOPWORDS = setOf(
            "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
            "return", "function", "const", "let", "var", "class", "extends", "implements",
            "interface", "type", "enum", "import", "from", "as", "export", "default",
            "new", "this", "super", "true", "false", "null", "undefined", "void",
            "async", "await", "yield", "try", "catch", "finally", "throw",
            "public", "private", "protected", "readonly", "static", "abstract",
            "string", "number", "boolean", "any", "unknown", "never", "object",
            "in", "of", "is", "or", "and", "not", "with", "def", "pass", "self",
            "val", "fun", "when", "companion", "override", "suspend", "data",
        )

        fun extractIdentifiers(text: String): List<String> =
            IDENTIFIER_RE.findAll(text)
                .map { it.value }
                .filter { it.length >= 3 && it !in STOPWORDS }
                .distinct()
                .toList()
    }
}
