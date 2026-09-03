package com.zhizhang.shortcut

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/** 桌面组件点击入口：只启动悬浮录音服务，不启动 MainActivity。 */
class VoiceInputReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val serviceIntent = Intent(context, VoiceCaptureService::class.java)
        runCatching { ContextCompat.startForegroundService(context, serviceIntent) }
    }
}
