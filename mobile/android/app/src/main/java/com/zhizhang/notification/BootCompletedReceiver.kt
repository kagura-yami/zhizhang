package com.zhizhang.notification

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.util.Log
import com.zhizhang.update.UpdateCheckScheduler
import com.zhizhang.shortcut.EdgeGestureService
import androidx.core.content.ContextCompat
import android.os.Build
import android.provider.Settings

/**
 * 开机完成广播接收器
 * 
 * 监听系统开机完成事件，确保 NotificationListenerService 在开机后能够正常启动。
 * 
 * 注意：NotificationListenerService 通常由系统自动管理，
 * 此接收器主要用于记录日志和执行可能需要的初始化操作。
 * 
 * @author zhizhang
 * @since 1.0.0
 */
class BootCompletedReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootCompletedReceiver"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context != null && intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            UpdateCheckScheduler.schedule(context)
            Log.i(TAG, "开机完成，请求系统重新绑定通知监听服务")
            NotificationListenerService.requestRebind(
                ComponentName(context, PaymentNotificationService::class.java)
            )
            val shortcutPrefs = context.getSharedPreferences("voice_shortcut", Context.MODE_PRIVATE)
            val triggerMode = shortcutPrefs.getString("trigger_mode", if (shortcutPrefs.getBoolean("edge_enabled", false)) "edge" else "widget")
            if (triggerMode == "edge" && (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context))) {
                runCatching { ContextCompat.startForegroundService(context, Intent(context, EdgeGestureService::class.java)) }
            }
        }
    }
}
