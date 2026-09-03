package com.zhizhang.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.view.View
import android.content.res.Configuration
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.zhizhang.MainActivity
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.Executors

/** 知账桌面账务总览组件。 */
class FinanceOverviewWidget : AppWidgetProvider() {
    companion object {
        const val ACTION_CONFIG_CHANGED = "com.zhizhang.widget.ACTION_CONFIG_CHANGED"
        /** 账单数据变化后由应用内部发送，立即触发组件同步。 */
        const val ACTION_DATA_CHANGED = "com.zhizhang.widget.ACTION_DATA_CHANGED"
        private const val SYNC_WORK_NAME = "finance-widget-sync"
        private val executor = Executors.newSingleThreadExecutor()
        private val currency = NumberFormat.getCurrencyInstance(Locale.CHINA).apply { currency = java.util.Currency.getInstance("CNY") }

        private data class WidgetConfig(
            val theme: String,
            val accent: String,
            val showBalance: Boolean,
            val showMonthly: Boolean,
            val compact: Boolean,
        )

        private fun readConfig(context: Context): WidgetConfig {
            val prefs = context.getSharedPreferences("finance_widget_config", Context.MODE_PRIVATE)
            return WidgetConfig(
                theme = prefs.getString("theme", "light") ?: "light",
                accent = prefs.getString("accent", "blue") ?: "blue",
                showBalance = prefs.getBoolean("show_balance", true),
                showMonthly = prefs.getBoolean("show_monthly", true),
                compact = prefs.getBoolean("compact", false),
            )
        }

        private fun updateViews(context: Context, manager: AppWidgetManager, id: Int, result: FinanceWidgetRepository.Result) {
            val views = RemoteViews(context.packageName, com.zhizhang.R.layout.widget_finance_overview)
            val config = readConfig(context)
            val dark = when (config.theme) {
                "dark" -> true
                "auto" -> (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
                else -> false
            }
            val accentColor = when (config.accent) {
                "green" -> android.graphics.Color.rgb(35, 125, 103)
                "purple" -> android.graphics.Color.rgb(112, 86, 176)
                else -> android.graphics.Color.rgb(72, 94, 151)
            }
            val primaryText = if (dark) android.graphics.Color.WHITE else android.graphics.Color.rgb(24, 41, 78)
            val secondaryText = if (dark) android.graphics.Color.rgb(196, 204, 224) else android.graphics.Color.rgb(99, 115, 154)
            // 这些设置之前只保存了偏好，却没有应用到 RemoteViews；在每次刷新时统一套用。
            views.setViewVisibility(com.zhizhang.R.id.widget_balance_group, if (config.showBalance) View.VISIBLE else View.GONE)
            views.setViewVisibility(com.zhizhang.R.id.widget_monthly_metrics, if (config.showMonthly) View.VISIBLE else View.GONE)
            views.setViewVisibility(com.zhizhang.R.id.widget_status, if (config.compact) View.GONE else View.VISIBLE)
            views.setTextColor(com.zhizhang.R.id.widget_header_hint, accentColor)
            views.setTextColor(com.zhizhang.R.id.widget_balance, primaryText)
            views.setTextColor(com.zhizhang.R.id.widget_balance_label, secondaryText)
            views.setTextColor(com.zhizhang.R.id.widget_status, secondaryText)
            views.setTextColor(com.zhizhang.R.id.widget_month_expense, if (dark) android.graphics.Color.rgb(255, 194, 200) else android.graphics.Color.rgb(123, 62, 69))
            views.setTextColor(com.zhizhang.R.id.widget_month_income, if (dark) android.graphics.Color.rgb(157, 235, 215) else android.graphics.Color.rgb(35, 107, 94))
            // 根视图保持透明，使用独立 surface 切换浅色/深色外壳，避免深色模式下出现白色外框。
            views.setImageViewResource(
                com.zhizhang.R.id.widget_surface,
                if (dark) com.zhizhang.R.drawable.widget_background_dark else com.zhizhang.R.drawable.widget_background,
            )
            // 装饰图始终保持透明素材，不能在深色模式下把装饰层替换成不透明背景。
            views.setImageViewResource(com.zhizhang.R.id.widget_decorations, com.zhizhang.R.drawable.widget_bg_art)
            // 浅色装饰素材在深色底上会形成高亮色块并遮挡文字，深色模式使用纯净表面。
            views.setViewVisibility(com.zhizhang.R.id.widget_decorations, if (dark) View.GONE else View.VISIBLE)
            // Vivo 启动器对 RemoteViews 的反射式属性动作兼容性不一致。
            // 背景、颜色和可见性全部由 XML 提供，更新时只写入文本与点击事件，避免整组视图变空白。
            views.setOnClickPendingIntent(com.zhizhang.R.id.widget_root, PendingIntent.getActivity(context, id, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            // 语音按钮只启动悬浮录音服务，不能把用户带回知账主界面。
            val voiceIntent = Intent(context, com.zhizhang.shortcut.VoiceInputReceiver::class.java)
            views.setOnClickPendingIntent(
                com.zhizhang.R.id.widget_voice_button,
                PendingIntent.getBroadcast(context, id + 100000, voiceIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            )

            when {
                !result.loggedIn -> {
                    views.setTextViewText(com.zhizhang.R.id.widget_balance, "登录后查看总览")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_income, "本月收入 —")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_expense, "本月支出 —")
                    views.setTextViewText(com.zhizhang.R.id.widget_status, "点击打开知账")
                }
                result.stats == null -> {
                    views.setTextViewText(com.zhizhang.R.id.widget_balance, "同步中…")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_income, "本月收入 —")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_expense, "本月支出 —")
                    views.setTextViewText(com.zhizhang.R.id.widget_status, "暂时无法获取数据")
                }
                else -> {
                    val stats = result.stats
                    val balancePrefix = if (stats.todayBalance >= 0) "+" else "−"
                    views.setTextViewText(com.zhizhang.R.id.widget_balance, balancePrefix + format(stats.todayBalance))
                    views.setTextViewText(com.zhizhang.R.id.widget_month_income, "本月收入 ${format(stats.monthIncome)}")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_expense, "本月支出 ${format(stats.monthExpense)}")
                    views.setTextViewText(com.zhizhang.R.id.widget_status, if (result.error) "网络异常，显示上次数据" else "更新于 ${timeLabel(stats.syncedAt)}")
                }
            }
            manager.updateAppWidget(id, views)
        }

        private fun format(value: Double): String = currency.format(value).replace("￥", "¥")
        private fun timeLabel(timestamp: Long): String = if (timestamp <= 0) "刚刚" else java.text.SimpleDateFormat("HH:mm", Locale.CHINA).format(java.util.Date(timestamp))

        fun scheduleSync(context: Context) {
            val request = PeriodicWorkRequestBuilder<FinanceWidgetSyncWorker>(15, java.util.concurrent.TimeUnit.MINUTES).build()
            WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
                SYNC_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        fun cancelSync(context: Context) {
            WorkManager.getInstance(context.applicationContext).cancelUniqueWork(SYNC_WORK_NAME)
        }
    }

    private fun updateAsync(context: Context, ids: IntArray) {
        val pending = goAsync()
        executor.execute {
            try {
                val result = FinanceWidgetRepository.load(context)
                val manager = AppWidgetManager.getInstance(context)
                ids.forEach { updateViews(context, manager, it, result) }
            } finally {
                pending.finish()
            }
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        scheduleSync(context)
        updateAsync(context, ids)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        scheduleSync(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        cancelSync(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, FinanceOverviewWidget::class.java))
        if (ids.isEmpty()) return
        when (intent.action) {
            ACTION_CONFIG_CHANGED, ACTION_DATA_CHANGED -> updateAsync(context, ids)
        }
    }
}
