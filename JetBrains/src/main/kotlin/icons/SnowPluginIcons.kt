package icons

import com.intellij.icons.AllIcons
import com.intellij.openapi.util.IconLoader
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.Icon
import kotlin.math.min

/**
 * Icon loader for Snow CLI plugin
 * Must be in 'icons' package and class name must end with 'Icons'
 */
object SnowPluginIcons {
    @JvmField
    val SnowAction: Icon = IconLoader.getIcon("/icons/snow.png", SnowPluginIcons::class.java)

    @JvmField
    val SnowToolbarAction: Icon = BoundedSquareIcon(SnowAction, 16)

    @JvmField
    val SnowStopToolbarAction: Icon = BoundedSquareIcon(AllIcons.Actions.Suspend, 16)
}

private class BoundedSquareIcon(
    private val source: Icon,
    private val size: Int,
) : Icon {
    override fun getIconWidth(): Int = size

    override fun getIconHeight(): Int = size

    override fun paintIcon(component: Component?, graphics: Graphics, x: Int, y: Int) {
        if (source.iconWidth <= 0 || source.iconHeight <= 0) {
            source.paintIcon(component, graphics, x, y)
            return
        }

        val graphics2d = graphics.create() as Graphics2D
        try {
            graphics2d.setRenderingHint(
                RenderingHints.KEY_INTERPOLATION,
                RenderingHints.VALUE_INTERPOLATION_BICUBIC,
            )
            graphics2d.setRenderingHint(
                RenderingHints.KEY_RENDERING,
                RenderingHints.VALUE_RENDER_QUALITY,
            )

            val scale = min(
                size.toDouble() / source.iconWidth.toDouble(),
                size.toDouble() / source.iconHeight.toDouble(),
            )
            val scaledWidth = source.iconWidth * scale
            val scaledHeight = source.iconHeight * scale
            graphics2d.translate(
                x + (size - scaledWidth) / 2.0,
                y + (size - scaledHeight) / 2.0,
            )
            graphics2d.scale(scale, scale)
            source.paintIcon(component, graphics2d, 0, 0)
        } finally {
            graphics2d.dispose()
        }
    }
}
