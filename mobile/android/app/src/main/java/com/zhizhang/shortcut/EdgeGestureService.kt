package com.zhizhang.shortcut

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.zhizhang.MainActivity
import com.zhizhang.R

/** 贴在屏幕左边缘的轻量手势热区，向右滑即可打开语音入口。 */
class EdgeGestureService : Service() {
    private var windowManager: WindowManager? = null
    private var edgeView: View? = null
    private var downX = 0f

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(7781, notification())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !android.provider.Settings.canDrawOverlays(this)) {
            stopSelf(); return
        }
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        edgeView = View(this).apply {
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { downX = event.rawX; true }
                    MotionEvent.ACTION_UP -> {
                        val delta = event.rawX - downX
                        if (delta > 100f) {
                            ContextCompat.startForegroundService(this@EdgeGestureService, Intent(this@EdgeGestureService, VoiceCaptureService::class.java))
                        }
                        true
                    }
                    else -> true
                }
            }
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE
        // 触摸热区使用 dp 而不是固定 px：18px 在高密度真机上几乎无法命中。
        val edgeWidth = (40 * resources.displayMetrics.density).toInt().coerceAtLeast(40)
        val params = WindowManager.LayoutParams(edgeWidth, WindowManager.LayoutParams.MATCH_PARENT, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT).apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL; y = 0 }
        runCatching { windowManager?.addView(edgeView, params) }.onFailure { stopSelf() }
    }

    override fun onDestroy() {
        runCatching { edgeView?.let { windowManager?.removeView(it) } }
        edgeView = null; windowManager = null
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel("voice_shortcut", "语音快捷入口", NotificationManager.IMPORTANCE_LOW))
        }
    }
    private fun notification(): Notification = NotificationCompat.Builder(this, "voice_shortcut")
        .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("知账语音快捷入口").setContentText("左边缘向右滑打开语音记账").setOngoing(true).setSilent(true).build()
}
