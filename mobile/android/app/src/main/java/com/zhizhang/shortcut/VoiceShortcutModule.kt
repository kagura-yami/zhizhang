package com.zhizhang.shortcut

import android.content.Intent
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** 语音快捷入口与左边缘手势控制。 */
class VoiceShortcutModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object { private const val PREFS = "voice_shortcut"; private const val KEY_MODE = "trigger_mode" }
    override fun getName(): String = "VoiceShortcutModule"

    @ReactMethod
    fun consumePendingVoiceRequest(promise: Promise) {
        val prefs = context.getSharedPreferences(PREFS, 0)
        val pending = prefs.getBoolean("pending_voice", false)
        if (pending) prefs.edit().putBoolean("pending_voice", false).apply()
        promise.resolve(pending)
    }

    @ReactMethod
    fun getEdgeGestureEnabled(promise: Promise) {
        promise.resolve(context.getSharedPreferences(PREFS, 0).getString(KEY_MODE, "widget") == "edge")
    }

    @ReactMethod
    fun setEdgeGestureEnabled(enabled: Boolean, promise: Promise) {
        try {
            context.getSharedPreferences(PREFS, 0).edit().putString(KEY_MODE, if (enabled) "edge" else "widget").putBoolean("edge_enabled", enabled).apply()
            val intent = Intent(context, EdgeGestureService::class.java)
            if (enabled) ContextCompat.startForegroundService(context, intent) else context.stopService(intent)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("EDGE_GESTURE_FAILED", "快捷手势设置失败，请先开启悬浮窗权限", error)
        }
    }

    @ReactMethod
    fun getTriggerMode(promise: Promise) {
        val prefs = context.getSharedPreferences(PREFS, 0)
        val storedMode = prefs.getString(KEY_MODE, null)
            ?: if (prefs.getBoolean("edge_enabled", false)) "edge" else "widget"
        // 旧版本曾把音量键无障碍方案保存为 volume。该方案无法可靠完成语音输入，
        // 读取时迁移到通知栏快捷按钮，避免用户再次进入无障碍设置。
        val mode = if (storedMode == "volume") {
            prefs.edit().putString(KEY_MODE, "tile").putBoolean("edge_enabled", false).apply()
            "tile"
        } else storedMode
        promise.resolve(mode)
    }

    @ReactMethod
    fun setTriggerMode(mode: String, promise: Promise) {
        if (mode != "widget" && mode != "edge" && mode != "tile") {
            promise.reject("INVALID_TRIGGER_MODE", "不支持的快捷入口方式")
            return
        }
        if (mode == "edge" && !Settings.canDrawOverlays(context)) {
            promise.reject("OVERLAY_PERMISSION_REQUIRED", "左边缘手势需要悬浮窗权限")
            return
        }
        try {
            context.getSharedPreferences(PREFS, 0).edit()
                .putString(KEY_MODE, mode)
                .putBoolean("edge_enabled", mode == "edge")
                .apply()
            val intent = Intent(context, EdgeGestureService::class.java)
            if (mode == "edge") ContextCompat.startForegroundService(context, intent) else context.stopService(intent)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("TRIGGER_MODE_FAILED", "快捷入口设置失败", error)
        }
    }

    @ReactMethod
    fun getOverlayPermissionStatus(promise: Promise) {
        promise.resolve(if (Settings.canDrawOverlays(context)) "authorized" else "denied")
    }
}
