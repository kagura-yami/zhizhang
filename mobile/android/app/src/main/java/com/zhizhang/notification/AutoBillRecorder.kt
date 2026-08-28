package com.zhizhang.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.security.MessageDigest
import java.util.Locale
import kotlin.math.min

/**
 * 自动记账执行器。
 *
 * 检测结果先持久化到本地队列，再调用后端创建账单。网络失败时保留队列并退避重试；
 * 同一通知的重复更新会被指纹和短时间语义去重拦截。
 */
class AutoBillRecorder(context: Context) {

    companion object {
        private const val TAG = "AutoBillRecorder"
        private const val PREFS_NAME = "auto_bill_recorder"
        private const val KEY_PENDING = "pending_records"
        private const val KEY_RECENT = "recent_records"
        private const val KEY_EXPENSE_CATEGORIES = "expense_categories"
        private const val EXACT_DEDUPE_MS = 7L * 24 * 60 * 60 * 1000
        private const val SEMANTIC_DEDUPE_MS = 45_000L
        private const val MAX_PENDING_RECORDS = 100
        private const val MAX_RECENT_RECORDS = 200
        private const val NOTIFICATION_PREFS = "bill_notification_settings"
        private const val KEY_NOTIFICATION_ENABLED = "enabled"
        private const val KEY_NOTIFICATION_SOUND = "sound"
        private const val KEY_NOTIFICATION_SOUND_URI = "sound_uri"
        private const val CHANNEL_SOUND = "bill_record_success_sound"
        private const val CHANNEL_SILENT = "bill_record_success_silent"
    }

    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val apiService = BillApiService(appContext)
    private val gson = Gson()
    private val lock = Any()

    @Volatile
    private var processing = false

    /**
     * 将支付事件加入自动记账队列。
     *
     * @return true 表示新事件已入队，false 表示被去重。
     */
    fun enqueue(
        packageName: String,
        rawContent: String,
        match: PaymentMatch,
        occurredAt: Long = System.currentTimeMillis()
    ): Boolean {
        val now = System.currentTimeMillis()
        val fingerprint = sha256(
            listOf(packageName, match.amount.toString(), normalize(rawContent)).joinToString("|")
        )
        val semanticKey = sha256(
            "%.2f".format(Locale.ROOT, match.amount)
        )

        synchronized(lock) {
            val recent = loadRecent().filter { now - it.createdAt <= EXACT_DEDUPE_MS }
            val pending = loadPending().toMutableList()

            val exactDuplicate = pending.any { it.fingerprint == fingerprint } ||
                recent.any { it.fingerprint == fingerprint }
            val semanticDuplicate = pending.any {
                it.semanticKey == semanticKey &&
                    it.source != match.source &&
                    now - it.createdAt <= SEMANTIC_DEDUPE_MS
            } || recent.any {
                it.semanticKey == semanticKey &&
                    it.source != null &&
                    it.source != match.source &&
                    now - it.createdAt <= SEMANTIC_DEDUPE_MS
            }

            if (exactDuplicate || semanticDuplicate) {
                Log.i(TAG, "跳过重复支付通知: source=${match.source}, amount=${match.amount}")
                saveRecent(recent)
                return false
            }

            pending += PendingAutoBill(
                fingerprint = fingerprint,
                semanticKey = semanticKey,
                amount = match.amount,
                source = match.source,
                categoryHint = match.categoryHint,
                description = match.description.take(200),
                paymentChannel = match.paymentChannel.take(50),
                counterparty = match.counterparty?.take(200),
                occurredAt = occurredAt,
                createdAt = now,
                nextAttemptAt = now
            )
            savePending(pending.takeLast(MAX_PENDING_RECORDS))
            saveRecent(recent)
            Log.i(TAG, "支付事件已进入自动记账队列: source=${match.source}, amount=${match.amount}")
        }

        retryPending()
        return true
    }

    /** 服务启动和心跳时调用，处理之前因断网等原因留下的记录。 */
    fun retryPending() {
        val record = synchronized(lock) {
            if (processing) return
            val now = System.currentTimeMillis()
            val next = loadPending().firstOrNull { it.nextAttemptAt <= now } ?: return
            processing = true
            next
        }

        apiService.getExpenseCategories { categories ->
            val availableCategories = when {
                !categories.isNullOrEmpty() -> {
                    saveCategories(categories)
                    categories
                }
                else -> loadCategories()
            }
            if (availableCategories.isEmpty()) {
                handleFailure(record, "暂时无法取得支出分类")
                return@getExpenseCategories
            }

            val category = selectCategory(availableCategories, record.categoryHint)
            if (category == null) {
                handleFailure(record, "没有可用的支出兜底分类")
                return@getExpenseCategories
            }
            apiService.createBill(
                amount = record.amount,
                categoryId = category?.id,
                description = record.description,
                paymentChannel = record.paymentChannel,
                counterparty = record.counterparty,
                sourceApp = record.source,
                occurredAt = record.occurredAt
            ) { success, errorMessage ->
                if (success) {
                    handleSuccess(record, category)
                } else {
                    handleFailure(record, errorMessage)
                }
            }
        }
    }

    private fun handleSuccess(record: PendingAutoBill, category: CategoryData?) {
        synchronized(lock) {
            val pending = loadPending().filterNot { it.fingerprint == record.fingerprint }
            savePending(pending)

            val now = System.currentTimeMillis()
            val recent = loadRecent()
                .filter { now - it.createdAt <= EXACT_DEDUPE_MS }
                .plus(RecentAutoBill(record.fingerprint, record.semanticKey, record.source, now))
                .takeLast(MAX_RECENT_RECORDS)
            saveRecent(recent)
            processing = false
        }

        LocalBroadcastManager.getInstance(appContext)
            .sendBroadcast(Intent(PaymentOverlayManager.ACTION_BILL_CREATED))
        showSuccessNotification(record)
        Log.i(
            TAG,
            "自动记账成功: source=${record.source}, amount=${record.amount}, category=${category?.name ?: "未分类"}"
        )
        retryPending()
    }

    /** 后端确认记账成功后发送系统通知；通知开关和铃声由设置页同步到原生存储。 */
    private fun showSuccessNotification(record: PendingAutoBill) {
        val settings = appContext.getSharedPreferences(NOTIFICATION_PREFS, Context.MODE_PRIVATE)
        if (!settings.getBoolean(KEY_NOTIFICATION_ENABLED, true)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            NotificationManagerCompat.from(appContext).areNotificationsEnabled().not()) return

        val sound = settings.getString(KEY_NOTIFICATION_SOUND, "default") ?: "default"
        val soundUri = settings.getString(KEY_NOTIFICATION_SOUND_URI, null)
        val channelId = when {
            sound == "silent" -> CHANNEL_SILENT
            sound == "custom" && !soundUri.isNullOrBlank() -> "bill_record_success_custom_${soundUri.hashCode()}"
            else -> CHANNEL_SOUND
        }
        ensureNotificationChannel(channelId, sound == "silent", if (sound == "custom") soundUri else null)
        val source = when (record.source.lowercase(Locale.ROOT)) {
            "wechat" -> "微信"
            "alipay" -> "支付宝"
            "pinduoduo" -> "拼多多"
            "meituan" -> "美团"
            "taobao" -> "淘宝"
            "jd" -> "京东"
            "eleme" -> "饿了么"
            "bank_sms" -> "银行卡短信"
            "bank_app" -> "银行应用"
            else -> "支付通知"
        }
        val detail = "$source · 支出 ¥${String.format(Locale.getDefault(), "%.2f", record.amount)}"
        val notification = NotificationCompat.Builder(appContext, channelId)
            .setSmallIcon(com.zhizhang.R.mipmap.ic_launcher)
            .setContentTitle("记账成功")
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        runCatching {
            NotificationManagerCompat.from(appContext).notify(record.fingerprint.hashCode(), notification)
        }.onFailure { Log.w(TAG, "发送记账成功通知失败", it) }
    }

    private fun ensureNotificationChannel(channelId: String, silent: Boolean, customSoundUri: String?) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = appContext.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(channelId) != null) return
        val channel = NotificationChannel(
            channelId,
            if (silent) "记账提醒（静音）" else "记账提醒",
            NotificationManager.IMPORTANCE_DEFAULT
        )
        if (silent) {
            channel.setSound(null, null)
        } else {
            channel.setSound(
                customSoundUri?.let(Uri::parse)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
        }
        manager.createNotificationChannel(channel)
    }

    private fun handleFailure(record: PendingAutoBill, errorMessage: String?) {
        synchronized(lock) {
            val pending = loadPending().map {
                if (it.fingerprint == record.fingerprint) {
                    val retries = it.retryCount + 1
                    val backoffMinutes = min(30, 1 shl min(retries - 1, 4))
                    it.copy(
                        retryCount = retries,
                        nextAttemptAt = System.currentTimeMillis() + backoffMinutes * 60_000L
                    )
                } else {
                    it
                }
            }
            savePending(pending)
            processing = false
        }
        Log.w(TAG, "自动记账失败，已进入重试队列: ${errorMessage ?: "未知错误"}")
    }

    private fun selectCategory(categories: List<CategoryData>, hint: String?): CategoryData? {
        if (categories.isEmpty()) return null

        if (!hint.isNullOrBlank()) {
            val aliases = when (hint) {
                "居住" -> setOf("居住", "住房")
                "住房" -> setOf("住房", "居住")
                else -> setOf(hint)
            }
            categories.firstOrNull { category ->
                aliases.any { category.name.equals(it, ignoreCase = true) }
            }?.let { return it }
            categories.firstOrNull {
                it.name.contains(hint, ignoreCase = true) || hint.contains(it.name, ignoreCase = true)
            }?.let { return it }
        }

        return categories.firstOrNull {
            it.name.equals("其他", ignoreCase = true) || it.name.equals("其他支出", ignoreCase = true)
        }
    }

    private fun loadCategories(): List<CategoryData> {
        val json = prefs.getString(KEY_EXPENSE_CATEGORIES, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<CategoryData>>() {}.type
            gson.fromJson<List<CategoryData>>(json, type).orEmpty()
        } catch (e: Exception) {
            Log.w(TAG, "读取支出分类缓存失败", e)
            emptyList()
        }
    }

    private fun saveCategories(categories: List<CategoryData>) {
        prefs.edit().putString(KEY_EXPENSE_CATEGORIES, gson.toJson(categories)).apply()
    }

    private fun loadPending(): List<PendingAutoBill> {
        val json = prefs.getString(KEY_PENDING, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<PendingAutoBill>>() {}.type
            gson.fromJson<List<PendingAutoBill>>(json, type).orEmpty()
        } catch (e: Exception) {
            Log.e(TAG, "读取自动记账队列失败", e)
            emptyList()
        }
    }

    private fun savePending(records: List<PendingAutoBill>) {
        prefs.edit().putString(KEY_PENDING, gson.toJson(records)).apply()
    }

    private fun loadRecent(): List<RecentAutoBill> {
        val json = prefs.getString(KEY_RECENT, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<RecentAutoBill>>() {}.type
            gson.fromJson<List<RecentAutoBill>>(json, type).orEmpty()
        } catch (e: Exception) {
            Log.e(TAG, "读取去重记录失败", e)
            emptyList()
        }
    }

    private fun saveRecent(records: List<RecentAutoBill>) {
        prefs.edit().putString(KEY_RECENT, gson.toJson(records.takeLast(MAX_RECENT_RECORDS))).apply()
    }

    private fun normalize(value: String): String {
        return value.lowercase(Locale.ROOT).replace(Regex("""\s+"""), " ").trim()
    }

    private fun sha256(value: String): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}

private data class PendingAutoBill(
    val fingerprint: String,
    val semanticKey: String,
    val amount: Double,
    val source: String,
    val categoryHint: String?,
    val description: String,
    val paymentChannel: String = "电子支付",
    val counterparty: String? = null,
    val occurredAt: Long = 0,
    val createdAt: Long,
    val retryCount: Int = 0,
    val nextAttemptAt: Long
)

private data class RecentAutoBill(
    val fingerprint: String,
    val semanticKey: String,
    val source: String? = null,
    val createdAt: Long
)
