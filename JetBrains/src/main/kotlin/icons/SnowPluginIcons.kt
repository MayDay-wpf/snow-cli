package icons

import com.intellij.openapi.util.IconLoader
import javax.swing.Icon

/**
 * Icon loader for Snow CLI plugin
 * Must be in 'icons' package and class name must end with 'Icons'
 */
object SnowPluginIcons {
    @JvmField
    val SnowAction: Icon = IconLoader.getIcon("/icons/snow.png", SnowPluginIcons::class.java)
}

