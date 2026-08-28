package com.litenote.widget

import android.content.Context
import android.util.Log
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.litenote.BuildConfig
import com.litenote.auth.AuthTokenModule
import okhttp3.OkHttpClient
import okhttp3.Request
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

/**
 * 桌面组件使用的轻量统计仓库。只缓存非敏感统计结果，认证令牌仍由 AuthTokenModule 统一保管。
 */
object FinanceWidgetRepository {
    private const val TAG = "FinanceWidgetRepository"
    private const val PREFS = "finance_widget_cache"
    private const val KEY_STATS = "stats"
    private const val KEY_SYNCED_AT = "synced_at"
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    data class Stats(
        val monthIncome: Double = 0.0,
        val monthExpense: Double = 0.0,
        val todayBalance: Double = 0.0,
        val syncedAt: Long = 0L,
    )

    data class Result(val stats: Stats?, val loggedIn: Boolean, val error: Boolean)

    fun load(context: Context): Result {
        val token = try {
            AuthTokenModule.getToken(context)
        } catch (error: Exception) {
            Log.w(TAG, "读取登录状态失败", error)
            null
        }
        if (token.isNullOrBlank()) return Result(null, loggedIn = false, error = false)

        return try {
            // 使用 Calendar 兼容 Android 7/7.1（minSdk 24），避免 java.time 在旧设备上触发类加载崩溃。
            val today = Calendar.getInstance()
            val dateFormatter = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val end = dateFormatter.format(today.time)
            today.set(Calendar.DAY_OF_MONTH, 1)
            val start = dateFormatter.format(today.time)
            val base = BuildConfig.API_BASE_URL.trimEnd('/')
            val url = "$base/bills/statistics?startDate=$start&endDate=$end&granularity=daily"
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .get()
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}")
                val body = response.body?.string().orEmpty()
                val root = JsonParser.parseString(body).asJsonObject
                val data = root.getAsJsonObject("data") ?: root
                val monthIncome = data.number("totalIncome")
                val monthExpense = data.number("totalExpense")
                val daily = data.getAsJsonArray("dailyTrends")
                var todayIncome = 0.0
                var todayExpense = 0.0
                daily?.firstOrNull { it.isJsonObject && it.asJsonObject.string("date") == end }?.asJsonObject?.let {
                    todayIncome = it.number("income")
                    todayExpense = it.number("expense")
                }
                val stats = Stats(monthIncome, monthExpense, todayIncome - todayExpense, System.currentTimeMillis())
                save(context, stats)
                Result(stats, loggedIn = true, error = false)
            }
        } catch (error: Exception) {
            Log.w(TAG, "桌面组件统计更新失败", error)
            Result(read(context), loggedIn = true, error = true)
        }
    }

    fun read(context: Context): Stats? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_STATS, null) ?: return null
        return try {
            val obj = JsonParser.parseString(json).asJsonObject
            Stats(obj.number("monthIncome"), obj.number("monthExpense"), obj.number("todayBalance"), prefs.getLong(KEY_SYNCED_AT, 0L))
        } catch (_: Exception) {
            null
        }
    }

    private fun save(context: Context, stats: Stats) {
        val obj = JsonObject().apply {
            addProperty("monthIncome", stats.monthIncome)
            addProperty("monthExpense", stats.monthExpense)
            addProperty("todayBalance", stats.todayBalance)
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_STATS, obj.toString())
            .putLong(KEY_SYNCED_AT, stats.syncedAt)
            .apply()
    }

    private fun JsonObject.number(name: String): Double =
        get(name)?.takeUnless { it.isJsonNull }?.asDouble ?: 0.0

    private fun JsonObject.string(name: String): String? =
        get(name)?.takeUnless { it.isJsonNull }?.asString
}
