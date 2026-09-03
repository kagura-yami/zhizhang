package com.zhizhang.widget

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** React Native 与桌面组件之间的个性化配置桥接。 */
class WidgetSettingsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object {
        private const val PREFS = "finance_widget_config"
        private const val KEY_THEME = "theme"
        private const val KEY_ACCENT = "accent"
        private const val KEY_SHOW_BALANCE = "show_balance"
        private const val KEY_SHOW_MONTHLY = "show_monthly"
        private const val KEY_COMPACT = "compact"
    }

    override fun getName(): String = "WidgetSettingsModule"

    @ReactMethod
    fun getSettings(promise: Promise) {
        try {
            val prefs = context.getSharedPreferences(PREFS, 0)
            promise.resolve(Arguments.createMap().apply {
                putString("theme", prefs.getString(KEY_THEME, "light"))
                putString("accent", prefs.getString(KEY_ACCENT, "blue"))
                putBoolean("showBalance", prefs.getBoolean(KEY_SHOW_BALANCE, true))
                putBoolean("showMonthly", prefs.getBoolean(KEY_SHOW_MONTHLY, true))
                putBoolean("compact", prefs.getBoolean(KEY_COMPACT, false))
            })
        } catch (error: Exception) {
            promise.reject("WIDGET_SETTINGS_READ_FAILED", "读取桌面组件设置失败", error)
        }
    }

    @ReactMethod
    fun saveSettings(settings: ReadableMap, promise: Promise) {
        try {
            context.getSharedPreferences(PREFS, 0).edit()
                .putString(KEY_THEME, settings.getString("theme") ?: "light")
                .putString(KEY_ACCENT, settings.getString("accent") ?: "blue")
                .putBoolean(KEY_SHOW_BALANCE, settings.getBoolean("showBalance"))
                .putBoolean(KEY_SHOW_MONTHLY, settings.getBoolean("showMonthly"))
                .putBoolean(KEY_COMPACT, settings.getBoolean("compact"))
                .apply()
            refresh()
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("WIDGET_SETTINGS_SAVE_FAILED", "保存桌面组件设置失败", error)
        }
    }

    @ReactMethod
    fun refreshWidget(promise: Promise) {
        refresh()
        promise.resolve(true)
    }

    private fun refresh() {
        context.sendBroadcast(Intent(context, FinanceOverviewWidget::class.java).setAction(FinanceOverviewWidget.ACTION_CONFIG_CHANGED))
    }
}
