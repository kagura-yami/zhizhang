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
import com.zhizhang.widget.FinanceOverviewWidget
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * 自动记账执行器。
 *
 * 检测结果先持久化到本地队列，再调用后端创建账单。收入和支出共用队列，网络失败时保留队列并退避重试；
 * 同一通知的重复更新会被指纹和短时间语义去重拦截。
 */
class AutoBillRecorder(context: Context) {

    companion object {
        private const val TAG = "AutoBillRecorder"
        private const val PREFS_NAME = "auto_bill_recorder"
        private const val KEY_PENDING = "pending_records"
        private const val KEY_RECENT = "recent_records"
        private const val KEY_EXPENSE_CATEGORIES = "expense_categories"
        private const val KEY_INCOME_CATEGORIES = "income_categories"
        private const val EXACT_DEDUPE_MS = 7L * 24 * 60 * 60 * 1000
        // 银行短信通常比微信/支付宝通知晚到数十秒到数分钟；扩大窗口，
        // 但只对“银行来源 + 支付应用来源”的交易对启用，避免误吞连续同额消费。
        private const val SEMANTIC_DEDUPE_MS = 10 * 60_000L
        // 同一应用发布通知更新时，正文经常只增加“查看详情”等尾缀；
        // 同源同金额同对象在短窗口内视为同一笔，避免连续重复入账。
        private const val SAME_SOURCE_DEDUPE_MS = 2 * 60_000L
        private const val NOTIFICATION_KEY_DEDUPE_MS = 24 * 60 * 60_000L
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
    private val retryScheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

    @Volatile
    private var processing = false

    /** 释放失败重试调度器，避免通知监听服务销毁后线程继续存活。 */
    fun shutdown() {
        retryScheduler.shutdownNow()
    }

    /**
     * 将支付事件加入自动记账队列。
     *
     * @return true 表示新事件已入队，false 表示被去重。
     */
    fun enqueue(
        packageName: String,
        rawContent: String,
        match: PaymentMatch,
        notificationKey: String? = null,
        notificationId: Int = 0,
        notificationTag: String? = null,
        notificationGroupKey: String? = null,
        occurredAt: Long = System.currentTimeMillis()
    ): Boolean {
        val now = System.currentTimeMillis()
        // 以通知身份和稳定交易字段生成指纹。通知正文会被系统反复更新，不能再把整段正文作为唯一依据。
        // 十分钟时间桶用于防止通知 ID 被应用复用时误吞后续同额交易。
        val eventTime = occurredAt.takeIf { it > 0 } ?: now
        val timeBucket = eventTime / (10 * 60_000L)
        val notificationIdentity = notificationKey?.takeIf { it.isNotBlank() }
            ?: listOf(notificationId.toString(), notificationTag.orEmpty(), notificationGroupKey.orEmpty(), timeBucket.toString()).joinToString("|")
        // 有交易号时，交易号就是跨短信/银行/支付应用最稳定的身份，不再把通知 key
        // 放进指纹；否则同一笔交易的不同来源会生成不同幂等键。没有交易号时才
        // 使用“来源+通知身份+结构化字段+时间桶”的保守指纹。
        val fingerprint = if (!match.transactionRef.isNullOrBlank()) {
            sha256(
                listOf(
                    "ref",
                    normalize(match.transactionRef),
                    match.type,
                    "%.2f".format(Locale.ROOT, match.amount),
                    normalizeCounterparty(match.counterparty.orEmpty()),
                    normalize(match.paymentChannel),
                    match.cardTail.orEmpty()
                ).joinToString("|")
            )
        } else {
            sha256(
                listOf(
                    packageName,
                    notificationIdentity,
                    match.type,
                    "%.2f".format(Locale.ROOT, match.amount),
                    normalizeCounterparty(match.counterparty.orEmpty()),
                    normalize(match.paymentChannel),
                    match.cardTail.orEmpty(),
                    timeBucket.toString()
                ).joinToString("|")
            )
        }
        val semanticKey = sha256(
            "${match.type}|%.2f".format(Locale.ROOT, match.amount)
        )

        synchronized(lock) {
            val recent = loadRecent().filter { now - it.createdAt <= EXACT_DEDUPE_MS }
            val pending = loadPending().toMutableList()

            val exactDuplicate = pending.any { it.fingerprint == fingerprint } ||
                recent.any { it.fingerprint == fingerprint }
            val semanticDuplicate = pending.any {
                isSemanticDuplicate(
                    existingSource = it.source,
                    existingAmountKey = it.semanticKey,
                    existingOccurredAt = it.occurredAt,
                    existingCreatedAt = it.createdAt,
                    existingPaymentChannel = it.paymentChannel,
                    existingCounterparty = it.counterparty,
                    existingTransactionRef = it.transactionRef,
                    existingCardTail = it.cardTail,
                    existingNotificationKey = it.notificationKey,
                    source = match.source,
                    amountKey = semanticKey,
                    occurredAt = occurredAt,
                    paymentChannel = match.paymentChannel,
                    counterparty = match.counterparty,
                    transactionRef = match.transactionRef,
                    cardTail = match.cardTail,
                    notificationKey = notificationKey,
                    now = now
                )
            } || recent.any {
                isSemanticDuplicate(
                    existingSource = it.source,
                    existingAmountKey = it.semanticKey,
                    existingOccurredAt = it.occurredAt,
                    existingCreatedAt = it.createdAt,
                    existingPaymentChannel = it.paymentChannel,
                    existingCounterparty = it.counterparty,
                    existingTransactionRef = it.transactionRef,
                    existingCardTail = it.cardTail,
                    existingNotificationKey = it.notificationKey,
                    source = match.source,
                    amountKey = semanticKey,
                    occurredAt = occurredAt,
                    paymentChannel = match.paymentChannel,
                    counterparty = match.counterparty,
                    transactionRef = match.transactionRef,
                    cardTail = match.cardTail,
                    notificationKey = notificationKey,
                    now = now
                )
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
                type = match.type,
                description = match.description.take(200),
                paymentChannel = match.paymentChannel.take(50),
                counterparty = match.counterparty?.take(200),
                transactionRef = match.transactionRef?.take(100),
                cardTail = match.cardTail?.take(8),
                balance = match.balance,
                notificationKey = notificationKey?.take(500),
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

        // 分类变化频率很低，优先使用本地缓存，避免每笔短信都额外等待一次网络请求。
        val cachedCategories = loadCategories(record.type)
        if (cachedCategories.isNotEmpty()) {
            createBill(record, cachedCategories)
            return
        }

        apiService.getCategories(record.type) { categories ->
            val availableCategories = if (!categories.isNullOrEmpty()) {
                saveCategories(record.type, categories)
                categories
            } else {
                loadCategories(record.type)
            }
            if (availableCategories.isEmpty()) {
                if (record.type == "income") {
                    // 收入允许不绑定分类，先落库再由用户补充，避免工资/退款因分类接口失败而漏记。
                    createBill(record, emptyList())
                } else {
                    handleFailure(record, "暂时无法取得支出分类")
                }
                return@getCategories
            }
            createBill(record, availableCategories)
        }
    }

    private fun createBill(record: PendingAutoBill, availableCategories: List<CategoryData>) {
        val category = selectCategory(availableCategories, record.categoryHint, record.type)
        if (category == null && record.type != "income") {
            handleFailure(record, "没有可用的支出兜底分类")
            return
        }
        apiService.createBill(
            amount = record.amount,
            categoryId = category?.id,
            description = record.description,
            type = record.type,
            paymentChannel = record.paymentChannel,
            counterparty = record.counterparty,
            sourceApp = record.source,
            isRefund = record.type == "income" && record.categoryHint == "退款",
            dedupeKey = record.fingerprint,
            dedupeMeta = listOfNotNull(
                record.transactionRef?.let { "ref=$it" },
                record.cardTail?.let { "card=$it" },
                record.balance?.let { "bal=${"%.2f".format(Locale.ROOT, it)}" },
                record.notificationKey?.let { "nk=${sha256(it)}" }
            ).joinToString(";").takeIf { it.isNotBlank() },
            occurredAt = record.occurredAt
        ) { success, errorMessage ->
            if (success) {
                handleSuccess(record, category)
            } else {
                handleFailure(record, errorMessage)
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
                .plus(
                    RecentAutoBill(
                        fingerprint = record.fingerprint,
                        semanticKey = record.semanticKey,
                        source = record.source,
                        paymentChannel = record.paymentChannel,
                        counterparty = record.counterparty,
                        transactionRef = record.transactionRef,
                        cardTail = record.cardTail,
                        balance = record.balance,
                        notificationKey = record.notificationKey,
                        occurredAt = record.occurredAt,
                        createdAt = now
                    )
                )
                .takeLast(MAX_RECENT_RECORDS)
            saveRecent(recent)
            processing = false
        }

        LocalBroadcastManager.getInstance(appContext)
            .sendBroadcast(Intent(PaymentOverlayManager.ACTION_BILL_CREATED))
        // 账单已落库后立即通知桌面组件，避免等待系统的周期刷新。
        appContext.sendBroadcast(
            Intent(appContext, FinanceOverviewWidget::class.java)
                .setAction(FinanceOverviewWidget.ACTION_DATA_CHANGED)
        )
        showSuccessNotification(record)
        Log.i(
            TAG,
            "自动记账成功: source=${record.source}, type=${record.type}, amount=${record.amount}, category=${category?.name ?: "未分类"}"
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
        val typeLabel = if (record.type == "income") "收入" else "支出"
        val detail = "$source · $typeLabel ¥${String.format(Locale.getDefault(), "%.2f", record.amount)}"
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
        var delaySeconds = 0L
        synchronized(lock) {
            val pending = loadPending().map {
                if (it.fingerprint == record.fingerprint) {
                    val retries = it.retryCount + 1
                    // 短暂 502/网络抖动无需等下一次 60 秒心跳：2、4、8…最多 60 秒重试。
                    delaySeconds = min(60, 2 shl min(retries - 1, 5)).toLong()
                    it.copy(
                        retryCount = retries,
                        nextAttemptAt = System.currentTimeMillis() + delaySeconds * 1_000L
                    )
                } else {
                    it
                }
            }
            savePending(pending)
            processing = false
        }
        if (delaySeconds > 0) {
            retryScheduler.schedule({ retryPending() }, delaySeconds, TimeUnit.SECONDS)
        }
        Log.w(TAG, "自动记账失败，已进入重试队列: ${errorMessage ?: "未知错误"}")
    }

    /**
     * 判断两条通知是否是同一笔交易的跨来源重复。
     * 微信/支付宝彼此不做金额级去重；只有银行短信/银行 App 与支付应用之间才合并。
     */
    private fun isSemanticDuplicate(
        existingSource: String?,
        existingAmountKey: String,
        existingOccurredAt: Long,
        existingCreatedAt: Long,
        existingPaymentChannel: String?,
        existingCounterparty: String?,
        existingTransactionRef: String?,
        existingCardTail: String?,
        existingNotificationKey: String?,
        source: String,
        amountKey: String,
        occurredAt: Long,
        paymentChannel: String?,
        counterparty: String?,
        transactionRef: String?,
        cardTail: String?,
        notificationKey: String?,
        now: Long
    ): Boolean {
        if (existingSource.isNullOrBlank() || existingAmountKey != amountKey) {
            return false
        }

        // 订单号/流水号和卡尾号是强证据：两边都存在且冲突时绝不合并。
        if (!existingTransactionRef.isNullOrBlank() && !transactionRef.isNullOrBlank() &&
            !normalize(existingTransactionRef).equals(normalize(transactionRef), ignoreCase = true)) {
            return false
        }
        if (!existingCardTail.isNullOrBlank() && !cardTail.isNullOrBlank() && existingCardTail != cardTail) {
            return false
        }
        val existingTime = existingOccurredAt.takeIf { it > 0 } ?: existingCreatedAt
        val currentTime = occurredAt.takeIf { it > 0 } ?: now
        // 同一条 StatusBarNotification 的 key 在正文更新时保持不变，这是最强的去重证据；
        // 仍限制在 24 小时内，避免应用复用固定通知 ID 时吞掉隔天的新交易。
        if (!existingNotificationKey.isNullOrBlank() && !notificationKey.isNullOrBlank() &&
            existingNotificationKey == notificationKey &&
            kotlin.math.abs(existingTime - currentTime) <= NOTIFICATION_KEY_DEDUPE_MS) {
            return true
        }
        // 相同交易号已经足以确认是同一笔交易，允许跨任意应用合并。
        if (!existingTransactionRef.isNullOrBlank() && !transactionRef.isNullOrBlank() &&
            normalize(existingTransactionRef).equals(normalize(transactionRef), ignoreCase = true)) {
            return true
        }
        val sameSource = existingSource.equals(source, ignoreCase = true)
        val sameMerchant = !existingCounterparty.isNullOrBlank() && !counterparty.isNullOrBlank() &&
            counterpartiesCompatible(existingCounterparty, counterparty)
        val bankPaymentPair = isBankSource(existingSource) xor isBankSource(source)
        val channelCompatible = paymentChannelsCompatible(existingPaymentChannel, paymentChannel)
        val oneSideMerchantMissing = existingCounterparty.isNullOrBlank() || counterparty.isNullOrBlank()
        // 微信只给“已支付¥17.98”、银行稍后给出“财付通-16688电商平台B”时，
        // 商户字段无法直接相等；银行+支付应用、同金额、同支付轨道且 2 分钟内
        // 足以确认同一笔，避免保守规则反而造成重复入账。
        if (!sameSource && bankPaymentPair && channelCompatible && oneSideMerchantMissing &&
            kotlin.math.abs(existingTime - currentTime) <= SAME_SOURCE_DEDUPE_MS) {
            return true
        }
        // 不同来源在几乎同一时刻报告同一商户、同金额交易，视为同一笔。
        // 90 秒窗口专门覆盖“支付应用通知 + 银行/短信通知”同时到达的情况。
        if (!sameSource && sameMerchant && kotlin.math.abs(existingTime - currentTime) <= 90_000L) {
            return true
        }
        if (!sameSource && !isBankSource(existingSource) && !isBankSource(source)) {
            return false
        }

        val window = if (sameSource) SAME_SOURCE_DEDUPE_MS else SEMANTIC_DEDUPE_MS
        if (kotlin.math.abs(existingTime - currentTime) > window &&
            kotlin.math.abs(existingCreatedAt - now) > window) {
            return false
        }

        // 两边都解析出商户时，商户不一致就不能合并；一边缺失时允许银行模板补充支付通知。
        if (!counterpartiesCompatible(existingCounterparty, counterparty)) {
            return false
        }
        // 卡尾号 + 商户 + 金额 + 短时间窗口是银行与支付应用之间的高置信度证据。
        // 只有双方都提供卡尾号和商户时才启用，避免同额连续消费被吞掉。
        if (!sameSource && existingCardTail.orEmpty().isNotBlank() && cardTail.orEmpty().isNotBlank() &&
            existingCardTail == cardTail &&
            existingCounterparty.orEmpty().isNotBlank() && counterparty.orEmpty().isNotBlank() &&
            counterpartiesCompatible(existingCounterparty, counterparty) &&
            kotlin.math.abs(existingTime - currentTime) <= SEMANTIC_DEDUPE_MS) {
            return true
        }
        if (sameSource && existingNotificationKey.isNullOrBlank() && notificationKey.isNullOrBlank() &&
            existingCounterparty.isNullOrBlank() && counterparty.isNullOrBlank() &&
            !existingPaymentChannel.orEmpty().equals(paymentChannel.orEmpty(), ignoreCase = true)) {
            return false
        }

        // 没有通知 key、交易号、商户或卡尾号时，只凭“同来源+同金额”无法区分
        // 连续两笔真实消费，禁止语义去重；精确指纹仍可拦截同一通知的重复回调。
        if (existingNotificationKey.isNullOrBlank() && notificationKey.isNullOrBlank() &&
            existingTransactionRef.isNullOrBlank() && transactionRef.isNullOrBlank() &&
            existingCounterparty.isNullOrBlank() && counterparty.isNullOrBlank() &&
            existingCardTail.isNullOrBlank() && cardTail.isNullOrBlank()) {
            return false
        }

        // 跨来源去重必须至少有共同商户或共同卡尾号，不能再仅凭金额和时间吞掉交易。
        if (!sameSource) {
            val sameCard = !existingCardTail.isNullOrBlank() && !cardTail.isNullOrBlank() &&
                existingCardTail == cardTail
            if (!sameMerchant && !sameCard) return false
        }

        // 银行通知可能只写“银行卡”，支付应用则会写具体渠道；两个具体渠道冲突时不合并。
        val leftChannel = existingPaymentChannel.orEmpty().trim()
        val rightChannel = paymentChannel.orEmpty().trim()
        if (leftChannel.isNotBlank() && rightChannel.isNotBlank() &&
            !isGenericBankChannel(leftChannel) && !isGenericBankChannel(rightChannel) &&
            !leftChannel.equals(rightChannel, ignoreCase = true)) {
            return false
        }
        return true
    }

    private fun isBankSource(source: String): Boolean =
        source.equals("bank_sms", ignoreCase = true) || source.equals("bank_app", ignoreCase = true)

    private fun isGenericBankChannel(channel: String): Boolean =
        channel == "银行卡" || channel == "银行支付" || channel == ""

    private fun paymentChannelsCompatible(left: String?, right: String?): Boolean {
        fun group(value: String?): String {
            val normalized = value.orEmpty().lowercase(Locale.ROOT)
            return when {
                normalized.contains("财付通") || normalized.contains("微信") -> "wechat"
                normalized.contains("支付宝") -> "alipay"
                normalized.contains("银联") || normalized.contains("云闪付") -> "unionpay"
                isGenericBankChannel(value.orEmpty()) -> "generic_bank"
                else -> normalized.replace(Regex("[^\\p{L}\\p{N}]"), "")
            }
        }
        val leftGroup = group(left)
        val rightGroup = group(right)
        if (leftGroup.isBlank() || rightGroup.isBlank()) return false
        return leftGroup == rightGroup || leftGroup == "generic_bank" || rightGroup == "generic_bank"
    }

    private fun counterpartiesCompatible(left: String?, right: String?): Boolean {
        if (left.isNullOrBlank() || right.isNullOrBlank()) return true
        val normalizedLeft = normalizeCounterparty(left)
        val normalizedRight = normalizeCounterparty(right)
        if (normalizedLeft.isBlank() || normalizedRight.isBlank()) return true
        return normalizedLeft == normalizedRight ||
            normalizedLeft.contains(normalizedRight) || normalizedRight.contains(normalizedLeft)
    }

    private fun normalizeCounterparty(value: String): String =
        value.lowercase(Locale.ROOT)
            .replace(Regex("[^\\p{L}\\p{N}]"), "")

    private fun selectCategory(categories: List<CategoryData>, hint: String?, type: String): CategoryData? {
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

        return if (type == "income") {
            categories.firstOrNull { it.name.equals("其他收入", ignoreCase = true) || it.name.equals("其他", ignoreCase = true) }
        } else {
            categories.firstOrNull { it.name.equals("其他", ignoreCase = true) || it.name.equals("其他支出", ignoreCase = true) }
        }
    }

    private fun loadCategories(type: String): List<CategoryData> {
        val key = if (type == "income") KEY_INCOME_CATEGORIES else KEY_EXPENSE_CATEGORIES
        val json = prefs.getString(key, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<CategoryData>>() {}.type
            gson.fromJson<List<CategoryData>>(json, type).orEmpty()
        } catch (e: Exception) {
            Log.w(TAG, "读取支出分类缓存失败", e)
            emptyList()
        }
    }

    private fun saveCategories(type: String, categories: List<CategoryData>) {
        val key = if (type == "income") KEY_INCOME_CATEGORIES else KEY_EXPENSE_CATEGORIES
        prefs.edit().putString(key, gson.toJson(categories)).apply()
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
    val type: String = "expense",
    val paymentChannel: String = "电子支付",
    val counterparty: String? = null,
    val transactionRef: String? = null,
    val cardTail: String? = null,
    val balance: Double? = null,
    val notificationKey: String? = null,
    val occurredAt: Long = 0,
    val createdAt: Long,
    val retryCount: Int = 0,
    val nextAttemptAt: Long
)

private data class RecentAutoBill(
    val fingerprint: String,
    val semanticKey: String,
    val createdAt: Long,
    val source: String? = null,
    val paymentChannel: String? = null,
    val counterparty: String? = null,
    val transactionRef: String? = null,
    val cardTail: String? = null,
    val balance: Double? = null,
    val notificationKey: String? = null,
    val occurredAt: Long = 0
)
