package com.litenote.notification

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.litenote.BuildConfig
import com.litenote.utils.SentryLogger
import org.json.JSONArray
import org.json.JSONObject

/**
 * 支付通知监听服务。
 *
 * 通知经过严格来源校验后直接进入自动记账队列，不再弹出需要手动选择分类的悬浮窗。
 */
class PaymentNotificationService : NotificationListenerService() {

    companion object {
        private const val TAG = "PaymentNotificationService"
        private const val PREFS_NAME = "payment_notification_config"
        private const val KEY_MONITORED_APPS = "monitored_apps"
        private const val KEY_FILTER_KEYWORDS = "filter_keywords"
        private const val KEY_CONFIG_VERSION = "config_version"
        private const val CURRENT_CONFIG_VERSION = 33

        const val ACTION_PAYMENT_DETECTED = "com.litenote.PAYMENT_DETECTED"
        const val EXTRA_PAYMENT_DATA = "payment_data"

        private val DEFAULT_PAYMENT_KEYWORDS = listOf(
            "支付成功", "付款成功", "扣款成功", "交易成功", "已支付", "消费", "支出"
        )

        private val DEFAULT_APP_NAMES = mapOf(
            PaymentNotificationParser.WECHAT_PACKAGE to "微信",
            PaymentNotificationParser.ALIPAY_PACKAGE to "支付宝"
        )

        private val LEGACY_AUTO_ENABLED_PACKAGES =
            PaymentNotificationParser.KNOWN_SUPPORTED_PACKAGES -
                PaymentNotificationParser.DEFAULT_SUPPORTED_PACKAGES -
                PaymentNotificationParser.BANK_APP_PACKAGES
    }

    private var supportedPackages: Set<String> = PaymentNotificationParser.DEFAULT_SUPPORTED_PACKAGES
    private var paymentKeywords: List<String> = DEFAULT_PAYMENT_KEYWORDS
    private lateinit var autoBillRecorder: AutoBillRecorder
    private val mainHandler = Handler(Looper.getMainLooper())

    private val configChangeListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == KEY_MONITORED_APPS || key == KEY_FILTER_KEYWORDS) {
            loadMonitoringConfig()
        }
    }

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            Log.i(TAG, "Service 心跳 - 监听 ${supportedPackages.size} 个应用")
            autoBillRecorder.retryPending()
            mainHandler.postDelayed(this, 60_000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "支付通知服务启动")
        SentryLogger.addBreadcrumb("PaymentNotificationService 启动", category = "service_lifecycle")

        autoBillRecorder = AutoBillRecorder(this)
        loadMonitoringConfig()

        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .registerOnSharedPreferenceChangeListener(configChangeListener)
        mainHandler.post(heartbeatRunnable)
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(heartbeatRunnable)
        runCatching {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .unregisterOnSharedPreferenceChangeListener(configChangeListener)
        }
        Log.i(TAG, "支付通知服务销毁")
        super.onDestroy()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.i(TAG, "通知监听服务已连接，自动记账已启用")
        autoBillRecorder.retryPending()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.w(TAG, "通知监听服务已断开，准备请求系统重新绑定")
        mainHandler.postDelayed({
            requestRebind(ComponentName(this, PaymentNotificationService::class.java))
        }, 2_000L)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || sbn.packageName !in supportedPackages) {
            return
        }

        try {
            val content = extractNotificationContent(sbn)
            val match = PaymentNotificationParser.parse(content, paymentKeywords)

            if (match == null) {
                Log.d(TAG, "通知未通过严格支付校验: package=${sbn.packageName}")
                return
            }

            if (BuildConfig.DEBUG) {
                Log.d(TAG, "支付通知通过校验: source=${match.source}, amount=${match.amount}")
            } else {
                Log.i(TAG, "检测到可信支付通知: source=${match.source}, amount=${match.amount}")
            }

            val queued = autoBillRecorder.enqueue(
                packageName = sbn.packageName,
                rawContent = content.allContent(),
                match = match,
                occurredAt = sbn.postTime.takeIf { it > 0 } ?: System.currentTimeMillis()
            )
            if (queued) {
                SentryLogger.addBreadcrumb(
                    "支付通知进入自动记账队列",
                    data = mapOf("source" to match.source, "amount" to match.amount),
                    category = "payment_detection"
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "处理支付通知失败", e)
            SentryLogger.e(TAG, "处理支付通知失败", e)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) = Unit

    private fun loadMonitoringConfig() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        try {
            val appsJson = prefs.getString(KEY_MONITORED_APPS, null)
            supportedPackages = if (appsJson.isNullOrBlank()) {
                PaymentNotificationParser.DEFAULT_SUPPORTED_PACKAGES
            } else {
                val apps = JSONArray(appsJson)
                val packages = mutableSetOf<String>()
                val migratedApps = JSONArray()
                val needsMigration = prefs.getInt(KEY_CONFIG_VERSION, 0) < CURRENT_CONFIG_VERSION
                for (index in 0 until apps.length()) {
                    val app = apps.getJSONObject(index)
                    val packageName = app.optString("packageName")
                    if (needsMigration && packageName in LEGACY_AUTO_ENABLED_PACKAGES) {
                        continue
                    }
                    migratedApps.put(app)
                    if (app.optBoolean("enabled", true) && packageName.isNotBlank()) {
                        packages.add(packageName)
                    }
                }

                if (needsMigration) {
                    val missingDefaults = PaymentNotificationParser.DEFAULT_SUPPORTED_PACKAGES - packages
                    missingDefaults.forEach { packageName ->
                        migratedApps.put(JSONObject().apply {
                            put("packageName", packageName)
                            put("appName", DEFAULT_APP_NAMES[packageName] ?: packageName)
                            put("enabled", true)
                        })
                    }
                    packages += missingDefaults
                    prefs.edit()
                        .putString(KEY_MONITORED_APPS, migratedApps.toString())
                        .putInt(KEY_CONFIG_VERSION, CURRENT_CONFIG_VERSION)
                        .apply()
                }
                packages
            }

            if (appsJson.isNullOrBlank()) {
                prefs.edit().putInt(KEY_CONFIG_VERSION, CURRENT_CONFIG_VERSION).apply()
            }

            val keywordsJson = prefs.getString(KEY_FILTER_KEYWORDS, null)
            paymentKeywords = if (keywordsJson.isNullOrBlank()) {
                DEFAULT_PAYMENT_KEYWORDS
            } else {
                val keywords = JSONArray(keywordsJson)
                buildList {
                    for (index in 0 until keywords.length()) {
                        keywords.optString(index).trim().takeIf { it.length >= 2 }?.let(::add)
                    }
                }.ifEmpty { DEFAULT_PAYMENT_KEYWORDS }
            }

            Log.i(TAG, "监听配置加载完成: $supportedPackages")
        } catch (e: Exception) {
            supportedPackages = PaymentNotificationParser.DEFAULT_SUPPORTED_PACKAGES
            paymentKeywords = DEFAULT_PAYMENT_KEYWORDS
            Log.e(TAG, "监听配置加载失败，已使用安全默认值", e)
        }
    }

    private fun extractNotificationContent(sbn: StatusBarNotification): PaymentNotificationContent {
        val notification = sbn.notification
        val extras: Bundle = notification.extras ?: Bundle.EMPTY
        return PaymentNotificationContent(
            packageName = sbn.packageName,
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty(),
            titleBig = extras.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString().orEmpty(),
            text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty(),
            subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString().orEmpty(),
            summaryText = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString().orEmpty(),
            bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty(),
            infoText = extras.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString().orEmpty(),
            tickerText = notification.tickerText?.toString().orEmpty(),
            channelId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                notification.channelId.orEmpty()
            } else {
                ""
            }
        )
    }
}
