package com.snow.plugin.actions

import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.editor.Caret
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.actionSystem.EditorAction
import com.intellij.openapi.editor.actionSystem.EditorActionHandler
import com.intellij.openapi.editor.actionSystem.EditorWriteActionHandler
import com.intellij.openapi.project.DumbAware
import com.snow.plugin.completion.SnowCompletionService
import com.snow.plugin.nextEdit.SnowNextEditEngine

/**
 * Snow CLI: Accept inline suggestion via TAB.
 *
 * Uses [EditorAction] + [isEnabledForCaret] so that when there is no inline
 * completion / next edit session active, this action will report itself as
 * disabled and IntelliJ will fall back to the default TAB behavior (smart
 * indent / dedent / live template / lookup) automatically. This avoids the
 * previous problem where a globally-replaced Tab handler caused the IDE's
 * auto-indent to overwrite the just-inserted completion text.
 */
class SnowAcceptInlineAction : EditorAction(AcceptHandler()), DumbAware {

    private class AcceptHandler : EditorWriteActionHandler() {

        override fun executeWriteAction(editor: Editor, caret: Caret?, dataContext: DataContext?) {
            // Inline completion has priority over next edit prediction
            val completion = SnowCompletionService.getInstance()
            if (completion.tryAccept(editor)) return

            val project = editor.project ?: return
            SnowNextEditEngine.getInstance(project).tryAccept(editor)
        }

        override fun isEnabledForCaret(editor: Editor, caret: Caret, dataContext: DataContext?): Boolean {
            val completion = SnowCompletionService.getInstance()
            if (completion.hasCompletion(editor)) return true
            val project = editor.project ?: return false
            return SnowNextEditEngine.getInstance(project).hasSessionForEditor(editor)
        }
    }
}

/**
 * Snow CLI: Dismiss inline suggestion via ESCAPE.
 *
 * Same rationale as [SnowAcceptInlineAction] — only intercept when we actually
 * have something to dismiss, otherwise let the IDE handle ESCAPE normally.
 */
class SnowDismissInlineAction : EditorAction(DismissHandler()), DumbAware {

    private class DismissHandler : EditorActionHandler() {

        override fun doExecute(editor: Editor, caret: Caret?, dataContext: DataContext) {
            val completion = SnowCompletionService.getInstance()
            if (completion.tryDismiss(editor)) return

            val project = editor.project ?: return
            SnowNextEditEngine.getInstance(project).tryDismiss(editor)
        }

        override fun isEnabledForCaret(editor: Editor, caret: Caret, dataContext: DataContext?): Boolean {
            val completion = SnowCompletionService.getInstance()
            if (completion.hasCompletion(editor)) return true
            val project = editor.project ?: return false
            return SnowNextEditEngine.getInstance(project).hasSessionForEditor(editor)
        }
    }
}
