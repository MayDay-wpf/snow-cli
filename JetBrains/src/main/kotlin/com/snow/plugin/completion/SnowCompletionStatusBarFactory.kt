package com.snow.plugin.completion

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.util.Consumer
import com.snow.plugin.config.SnowBundle
import java.awt.event.MouseEvent
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class SnowCompletionStatusBarFactory : StatusBarWidgetFactory {
    override fun getId(): String = WIDGET_ID
    override fun getDisplayName(): String = SnowBundle.message("statusBar.completion.name")
    override fun isAvailable(project: Project): Boolean = true
    override fun createWidget(project: Project): StatusBarWidget = SnowCompletionStatusBarWidget(project)
    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true

    companion object {
        const val WIDGET_ID = "SnowCompletionStatus"
    }
}

class SnowCompletionStatusBarWidget(private val project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation {
    private var statusBar: StatusBar? = null
    @Volatile var loading = false
    @Volatile var message: String? = null

    private val spinner = charArrayOf('⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏')
    @Volatile private var spinnerIndex = 0
    private val animationScheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "Snow-StatusBar-Spinner").apply { isDaemon = true }
    }
    @Volatile private var animationFuture: ScheduledFuture<*>? = null

    override fun ID(): String = SnowCompletionStatusBarFactory.WIDGET_ID
    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this
    override fun install(statusBar: StatusBar) { this.statusBar = statusBar }
    override fun dispose() {
        animationFuture?.cancel(true)
        animationScheduler.shutdownNow()
        statusBar = null
    }

    override fun getText(): String {
        val config = SnowCompletionConfig.getInstance()
        val msg = message
        if (msg != null) return "Snow AI: $msg"
        if (!config.enabled) return SnowBundle.message("statusBar.completion.off")
        if (loading) {
            val frame = spinner[spinnerIndex % spinner.size]
            val model = config.model.ifEmpty { config.provider }
            return "$frame Snow AI · $model"
        }
        return SnowBundle.message("statusBar.completion.active", config.provider)
    }

    override fun getTooltipText(): String {
        val config = SnowCompletionConfig.getInstance()
        val msg = message
        if (msg != null) return msg
        if (!config.enabled) return SnowBundle.message("statusBar.completion.tooltip.off")
        if (loading) return SnowBundle.message("statusBar.completion.tooltip.loading", config.provider, config.model.ifEmpty { "no model" })
        return SnowBundle.message("statusBar.completion.tooltip.active", config.provider, config.model.ifEmpty { "no model" })
    }

    override fun getAlignment(): Float = 0f

    override fun getClickConsumer(): Consumer<MouseEvent> = Consumer {
        val config = SnowCompletionConfig.getInstance()
        config.state.enabled = !config.state.enabled
        statusBar?.updateWidget(SnowCompletionStatusBarFactory.WIDGET_ID)
    }

    fun update() {
        if (loading) {
            startAnimation()
        } else {
            stopAnimation()
        }
        statusBar?.updateWidget(SnowCompletionStatusBarFactory.WIDGET_ID)
    }

    private fun startAnimation() {
        if (animationFuture != null) return
        spinnerIndex = 0
        animationFuture = animationScheduler.scheduleAtFixedRate({
            spinnerIndex++
            statusBar?.updateWidget(SnowCompletionStatusBarFactory.WIDGET_ID)
        }, 120, 120, TimeUnit.MILLISECONDS)
    }

    private fun stopAnimation() {
        animationFuture?.cancel(false)
        animationFuture = null
    }
}
