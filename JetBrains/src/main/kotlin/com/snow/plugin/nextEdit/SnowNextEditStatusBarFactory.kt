package com.snow.plugin.nextEdit

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

class SnowNextEditStatusBarFactory : StatusBarWidgetFactory {
    override fun getId(): String = WIDGET_ID
    override fun getDisplayName(): String = SnowBundle.message("statusBar.nextEdit.name")
    override fun isAvailable(project: Project): Boolean = true
    override fun createWidget(project: Project): StatusBarWidget = SnowNextEditStatusBarWidget(project)
    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true

    companion object {
        const val WIDGET_ID = "SnowNextEditStatus"
    }
}

class SnowNextEditStatusBarWidget(private val project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation {
    private var statusBar: StatusBar? = null

    private val spinner = charArrayOf('⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏')
    @Volatile private var spinnerIndex = 0
    private val animationScheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "Snow-NextEdit-StatusBar-Spinner").apply { isDaemon = true }
    }
    @Volatile private var animationFuture: ScheduledFuture<*>? = null

    override fun ID(): String = SnowNextEditStatusBarFactory.WIDGET_ID
    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this
    override fun install(statusBar: StatusBar) { this.statusBar = statusBar }
    override fun dispose() {
        animationFuture?.cancel(true)
        animationScheduler.shutdownNow()
        statusBar = null
    }

    private fun isLoading(): Boolean {
        val engine = try { SnowNextEditEngine.getInstance(project) } catch (_: Exception) { return false }
        return engine.isWorking()
    }

    override fun getText(): String {
        val config = SnowNextEditConfig.getInstance()
        if (!config.enabled) return SnowBundle.message("statusBar.nextEdit.off")
        val engine = try { SnowNextEditEngine.getInstance(project) } catch (_: Exception) { null }
        if (engine?.isWorking() == true) {
            val frame = spinner[spinnerIndex % spinner.size]
            return "$frame Snow Next"
        }
        if (engine?.hasSession() == true) return SnowBundle.message("statusBar.nextEdit.active")
        return SnowBundle.message("statusBar.nextEdit.idle")
    }

    override fun getTooltipText(): String {
        val config = SnowNextEditConfig.getInstance()
        if (!config.enabled) return SnowBundle.message("statusBar.nextEdit.tooltip.off")
        val engine = try { SnowNextEditEngine.getInstance(project) } catch (_: Exception) { null }
        if (engine?.isWorking() == true) return SnowBundle.message("statusBar.nextEdit.tooltip.loading")
        if (engine?.hasSession() == true) return SnowBundle.message("statusBar.nextEdit.tooltip.active")
        return SnowBundle.message("statusBar.nextEdit.tooltip.idle")
    }

    override fun getAlignment(): Float = 0f

    override fun getClickConsumer(): Consumer<MouseEvent> = Consumer {
        val config = SnowNextEditConfig.getInstance()
        config.state.enabled = !config.state.enabled
        update()
    }

    fun update() {
        if (isLoading()) {
            startAnimation()
        } else {
            stopAnimation()
        }
        statusBar?.updateWidget(SnowNextEditStatusBarFactory.WIDGET_ID)
    }

    private fun startAnimation() {
        if (animationFuture != null) return
        spinnerIndex = 0
        animationFuture = animationScheduler.scheduleAtFixedRate({
            spinnerIndex++
            statusBar?.updateWidget(SnowNextEditStatusBarFactory.WIDGET_ID)
        }, 120, 120, TimeUnit.MILLISECONDS)
    }

    private fun stopAnimation() {
        animationFuture?.cancel(false)
        animationFuture = null
    }
}
