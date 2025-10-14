package com.snow.plugin.actions

import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

/**
 * Simple test action to verify notifications work
 */
class TestNotificationAction : AnAction("Test Notification") {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        val notification = Notification(
            "Snow CLI",
            "Test",
            "This is notification 1",
            NotificationType.INFORMATION
        )
        Notifications.Bus.notify(notification, project)

        val notification2 = Notification(
            "Snow CLI",
            "Test",
            "This is notification 2",
            NotificationType.WARNING
        )
        Notifications.Bus.notify(notification2, project)

        val notification3 = Notification(
            "Snow CLI",
            "Test",
            "This is notification 3",
            NotificationType.ERROR
        )
        Notifications.Bus.notify(notification3, project)
    }
}
