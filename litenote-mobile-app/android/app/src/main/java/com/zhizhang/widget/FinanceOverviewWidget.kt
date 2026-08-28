package com.zhizhang.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.widget.RemoteViews
import com.zhizhang.MainActivity
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.Executors

/** 知帐桌面账务总览组件。 */
class FinanceOverviewWidget : AppWidgetProvider() {
    companion object {
        const val ACTION_REFRESH = "com.zhizhang.widget.ACTION_REFRESH"
        private val executor = Executors.newSingleThreadExecutor()
        private val currency = NumberFormat.getCurrencyInstance(Locale.CHINA).apply { currency = java.util.Currency.getInstance("CNY") }

        private fun updateViews(context: Context, manager: AppWidgetManager, id: Int, result: FinanceWidgetRepository.Result) {
            val views = RemoteViews(context.packageName, com.zhizhang.R.layout.widget_finance_overview)
            views.setOnClickPendingIntent(com.zhizhang.R.id.widget_root, PendingIntent.getActivity(context, id, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            views.setOnClickPendingIntent(com.zhizhang.R.id.widget_refresh, PendingIntent.getBroadcast(context, id + 100000, Intent(context, FinanceOverviewWidget::class.java).setAction(ACTION_REFRESH), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))

            when {
                !result.loggedIn -> {
                    views.setTextViewText(com.zhizhang.R.id.widget_balance, "登录后查看总览")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_income, "本月收入 —")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_expense, "本月支出 —")
                    views.setTextViewText(com.zhizhang.R.id.widget_status, "点击打开知帐")
                }
                result.stats == null -> {
                    views.setTextViewText(com.zhizhang.R.id.widget_balance, "点击刷新")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_income, "本月收入 —")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_expense, "本月支出 —")
                    views.setTextViewText(com.zhizhang.R.id.widget_status, "暂时无法获取数据")
                }
                else -> {
                    val stats = result.stats
                    val balancePrefix = if (stats.todayBalance >= 0) "+" else "−"
                    views.setTextViewText(com.zhizhang.R.id.widget_balance, balancePrefix + format(stats.todayBalance))
                    views.setTextColor(com.zhizhang.R.id.widget_balance, if (stats.todayBalance >= 0) Color.rgb(27, 132, 91) else Color.rgb(198, 72, 67))
                    views.setTextViewText(com.zhizhang.R.id.widget_month_income, "本月收入 ${format(stats.monthIncome)}")
                    views.setTextViewText(com.zhizhang.R.id.widget_month_expense, "本月支出 ${format(stats.monthExpense)}")
                    views.setTextViewText(com.zhizhang.R.id.widget_status, if (result.error) "网络异常，显示上次数据" else "更新于 ${timeLabel(stats.syncedAt)}")
                }
            }
            manager.updateAppWidget(id, views)
        }

        private fun format(value: Double): String = currency.format(value).replace("￥", "¥")
        private fun timeLabel(timestamp: Long): String = if (timestamp <= 0) "刚刚" else java.text.SimpleDateFormat("HH:mm", Locale.CHINA).format(java.util.Date(timestamp))
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

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = updateAsync(context, ids)

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, FinanceOverviewWidget::class.java))
            if (ids.isNotEmpty()) updateAsync(context, ids)
        }
    }
}
