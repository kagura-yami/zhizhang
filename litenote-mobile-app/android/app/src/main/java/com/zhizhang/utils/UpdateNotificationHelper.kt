package com.zhizhang.utils

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.zhizhang.MainActivity

/**
 * 应用更新通知的统一实现。
 *
 * JS 前台检查和 WorkManager 后台检查都复用这里，避免两个入口使用不同的
 * 通知渠道或重复提醒策略。相同版本只提醒一次，用户打开应用后仍可继续看到
 * 前台更新弹窗。
 */
object UpdateNotificationHelper {
    private const val TAG = "UpdateNotification"
    private const val CHANNEL_ID = "app_updates"
    private const val PREFS_NAME = "app_update_notifications"
    private const val LAST_NOTIFIED_VERSION = "last_notified_version"

    @Synchronized
    fun notifyIfNeeded(context: Context, version: String, updateLog: String?): Boolean {
        if (version.isBlank() || !canPostNotifications(context)) return false

        val appContext = context.applicationContext
        val preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (preferences.getString(LAST_NOTIFIED_VERSION, null) == version) {
            return true
        }

        return runCatching {
            ensureNotificationChannel(appContext)
            val openAppIntent = Intent(appContext, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                appContext,
                version.hashCode(),
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
            )
            val detail = updateLog?.trim()?.takeIf { it.isNotEmpty() }
                ?: "打开应用即可查看更新内容"
            val notification = NotificationCompat.Builder(appContext, CHANNEL_ID)
                .setSmallIcon(com.zhizhang.R.mipmap.ic_launcher)
                .setContentTitle("知帐有新版本")
                .setContentText("版本 $version 已发布，点击查看更新")
                .setStyle(NotificationCompat.BigTextStyle().bigText("版本 $version 已发布\n$detail"))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build()
            NotificationManagerCompat.from(appContext)
                .notify("zhizhang_app_update", version.hashCode(), notification)
            preferences.edit().putString(LAST_NOTIFIED_VERSION, version).apply()
            true
        }.onFailure { error ->
            android.util.Log.w(TAG, "发送更新通知失败", error)
        }.getOrDefault(false)
    }

    private fun canPostNotifications(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun ensureNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "应用更新",
                    NotificationManager.IMPORTANCE_DEFAULT
                )
            )
        }
    }
}
