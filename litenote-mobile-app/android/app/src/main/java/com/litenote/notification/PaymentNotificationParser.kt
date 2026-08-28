package com.litenote.notification

import java.util.Locale

/**
 * 从通知中解析可自动入账的支出。
 *
 * 识别策略采用 fail-closed：必须同时满足可信来源、明确支出语义和有效金额，
 * 普通聊天里单独出现“支付”“100 元”等字样不会触发。
 */
object PaymentNotificationParser {

    const val WECHAT_PACKAGE = "com.tencent.mm"
    const val ALIPAY_PACKAGE = "com.eg.android.AlipayGphone"
    const val PINDUODUO_PACKAGE = "com.xunmeng.pinduoduo"
    const val MEITUAN_PACKAGE = "com.sankuai.meituan"
    const val TAOBAO_PACKAGE = "com.taobao.taobao"
    const val JD_PACKAGE = "com.jingdong.app.mall"
    const val ELEME_PACKAGE = "me.ele"
    const val ICBC_PACKAGE = "com.icbc"

    val SMS_PACKAGES = setOf(
        "com.hihonor.mms",
        "com.android.mms",
        // 部分厂商将通知实际交由短信服务进程发布，而不是主短信应用。
        "com.android.mms.service",
        "com.google.android.apps.messaging"
    )

    val BANK_APP_PACKAGES = setOf(ICBC_PACKAGE)

    val DEFAULT_SUPPORTED_PACKAGES = setOf(
        WECHAT_PACKAGE,
        ALIPAY_PACKAGE
    )

    val KNOWN_SUPPORTED_PACKAGES = setOf(
        WECHAT_PACKAGE,
        ALIPAY_PACKAGE,
        PINDUODUO_PACKAGE
    ) + SMS_PACKAGES + BANK_APP_PACKAGES

    private val incomeOrReversalKeywords = listOf(
        "收款成功", "收款到账", "收款金额", "到账", "入账", "收入", "转入", "存入", "退款", "退货", "撤销", "冲正", "红包"
    )

    private val amountPatterns = listOf(
        Regex("""(?:人民币|RMB|CNY|¥|￥)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE),
        Regex("""([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*元"""),
        Regex(
            """(?:支付成功|付款成功|成功付款|成功支付|已支付|已付款|扣款成功|扣费成功|已扣款|已扣费|实付)\s*[：:]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"""
        )
    )

    /**
     * 规则按“更具体的消费场景优先”排列。同一条通知命中多个分类时，优先采用最先
     * 出现的分类，避免“美团外卖”被宽泛的购物/平台词抢先匹配。
     */
    private val categoryRules = linkedMapOf(
        "餐饮" to listOf(
            "美团外卖", "饿了么", "外卖", "餐饮", "餐厅", "饭店", "小吃", "食堂", "烧烤",
            "火锅", "咖啡", "奶茶", "茶饮", "瑞幸", "星巴克", "肯德基", "麦当劳", "必胜客",
            "海底捞", "美团支付"
        ),
        "交通" to listOf(
            "滴滴", "高德打车", "曹操出行", "哈啰", "打车", "网约车", "出租车", "地铁",
            "公交", "加油站", "加油", "充电桩", "停车", "高速", "ETC", "铁路12306",
            "12306", "高铁", "火车票", "航空", "机票"
        ),
        "医疗" to listOf(
            "医院", "药房", "药店", "医疗", "挂号", "门诊", "诊所", "体检", "医保", "口腔"
        ),
        "教育" to listOf(
            "学费", "培训", "课程", "教育", "书店", "教材", "考试", "报名费", "文具"
        ),
        "居住" to listOf(
            "房租", "租房", "住房", "物业", "水费", "电费", "燃气", "天然气", "宽带",
            "话费", "通信缴费", "中国移动", "中国联通", "中国电信"
        ),
        "娱乐" to listOf(
            "游戏充值", "游戏", "电影票", "电影院", "影院", "视频会员", "音乐会员", "会员续费",
            "会员充值", "KTV", "演出", "门票", "娱乐", "爱奇艺", "腾讯视频", "哔哩哔哩"
        ),
        "购物" to listOf(
            "拼多多", "淘宝", "天猫", "京东", "唯品会", "苏宁", "抖音商城", "快手小店",
            "盒马", "山姆", "沃尔玛", "永辉", "便利店", "超市", "商场", "商城", "购物",
            "商店", "快递", "电商"
        )
    )

    fun parse(data: PaymentNotificationContent, customKeywords: List<String> = emptyList()): PaymentMatch? {
        val content = data.allContent()
        if (content.isBlank() || incomeOrReversalKeywords.any(content::contains)) {
            return null
        }

        val amount = extractAmount(content) ?: return null
        if (amount <= 0.0) {
            return null
        }

        val source = when (data.packageName) {
            WECHAT_PACKAGE -> parseWechat(data, content, customKeywords)
            ALIPAY_PACKAGE -> parseAlipay(data, content, customKeywords)
            PINDUODUO_PACKAGE -> parsePinduoduo(content)
            MEITUAN_PACKAGE -> parsePlatform(data, content, customKeywords, "美团", "meituan")
            TAOBAO_PACKAGE -> parsePlatform(data, content, customKeywords, "淘宝", "taobao")
            JD_PACKAGE -> parsePlatform(data, content, customKeywords, "京东", "jd")
            ELEME_PACKAGE -> parsePlatform(data, content, customKeywords, "饿了么", "eleme")
            in SMS_PACKAGES -> parseBankSms(data, content, customKeywords)
            in BANK_APP_PACKAGES -> parseBankApp(data, content, customKeywords)
            else -> null
        } ?: return null

        val paymentChannel = inferPaymentChannel(source, content)
        val counterparty = extractCounterparty(data, source)
        val categoryContent = listOfNotNull(counterparty, content).joinToString(" ")
        val categoryHint = if (data.packageName == PINDUODUO_PACKAGE) {
            "购物"
        } else {
            inferCategory(categoryContent)
        }
        val summary = counterparty ?: extractSummary(data, source, paymentChannel)

        return PaymentMatch(
            amount = amount,
            source = source,
            categoryHint = categoryHint,
            description = summary,
            paymentChannel = paymentChannel,
            counterparty = counterparty
        )
    }

    private fun parseWechat(
        data: PaymentNotificationContent,
        content: String,
        customKeywords: List<String>
    ): String? {
        val officialIdentity = listOf(data.title, data.titleBig, data.subText).any {
            it.contains("微信支付") || it.contains("支付助手")
        } || content.contains("微信支付凭证")

        val strongAction = containsAny(
            content,
            listOf("支付成功", "付款成功", "扣款成功", "扣费成功", "交易成功", "已支付", "已扣费") +
                sanitizeKeywords(customKeywords)
        )
        return if (officialIdentity && strongAction) "wechat" else null
    }

    private fun parseAlipay(
        data: PaymentNotificationContent,
        content: String,
        customKeywords: List<String>
    ): String? {
        val officialIdentity = listOf(data.title, data.titleBig, data.subText).any {
            containsAny(it, listOf("支付宝", "交易提醒", "支付助手", "账单"))
        } || content.contains("支付宝")

        val strongAction = containsAny(
            content,
            listOf(
                "支付成功", "付款成功", "成功付款", "成功支付", "已支付", "已付款",
                "扣款成功", "扣费成功", "已扣款", "已扣费", "交易成功", "支出", "消费"
            ) + sanitizeKeywords(customKeywords)
        )
        return if (officialIdentity && strongAction) "alipay" else null
    }

    private fun parsePinduoduo(content: String): String? {
        val strongAction = containsAny(
            content,
            listOf("支付成功", "付款成功", "订单已支付", "成功支付", "扣款成功")
        )
        return if (strongAction) "pinduoduo" else null
    }

    /** 已由用户加入监听的购物/生活应用，要求通知正文同时出现平台身份和支付动作。 */
    private fun parsePlatform(
        data: PaymentNotificationContent,
        content: String,
        customKeywords: List<String>,
        identityKeyword: String,
        source: String
    ): String? {
        val identity = listOf(data.title, data.titleBig, data.subText, content).any {
            it.contains(identityKeyword, ignoreCase = true)
        }
        val strongAction = containsAny(
            content,
            listOf("支付成功", "付款成功", "成功付款", "成功支付", "订单已支付", "已支付", "已付款", "扣款成功", "扣费成功", "消费", "支出") + sanitizeKeywords(customKeywords)
        )
        return if (identity && strongAction) source else null
    }

    private fun parseBankSms(
        data: PaymentNotificationContent,
        content: String,
        customKeywords: List<String>
    ): String? {
        val title = data.title.trim()
        val bankIdentity = containsAny(
            content,
            listOf("银行", "信用卡", "储蓄卡", "借记卡", "尾号", "账户", "卡号")
        ) || Regex("""^9[0-9]{4,5}$""").matches(title)

        val outgoingAction = containsAny(
            content,
            listOf("消费", "支出", "扣款", "支付", "转出", "快捷支付", "交易金额") + sanitizeKeywords(customKeywords)
        )
        return if (bankIdentity && outgoingAction) "bank_sms" else null
    }

    private fun parseBankApp(
        data: PaymentNotificationContent,
        content: String,
        customKeywords: List<String>
    ): String? {
        val bankIdentity = listOf(data.title, data.titleBig, data.subText).any {
            containsAny(it, listOf("工商银行", "动账通知", "交易提醒"))
        } || containsAny(content, listOf("工商银行", "尾号", "动账通知"))

        val outgoingAction = containsAny(
            content,
            listOf("消费", "支出", "扣款", "支付", "转出", "快捷支付", "交易金额") +
                sanitizeKeywords(customKeywords)
        )
        return if (bankIdentity && outgoingAction) "bank_app" else null
    }

    private fun extractAmount(content: String): Double? {
        data class Candidate(val amount: Double, val score: Int, val position: Int)

        val candidates = mutableListOf<Candidate>()
        amountPatterns.forEach { pattern ->
            pattern.findAll(content).forEach { match ->
                val value = match.groupValues[1].replace(",", "").toDoubleOrNull() ?: return@forEach
                val start = (match.range.first - 18).coerceAtLeast(0)
                val end = (match.range.last + 19).coerceAtMost(content.length)
                val context = content.substring(start, end)
                var score = 0
                if (containsAny(context, listOf("消费", "支出", "扣款", "支付", "付款", "交易金额", "转出"))) score += 4
                if (containsAny(context, listOf("余额", "可用额度", "可用余额", "账户余额"))) score -= 6
                candidates += Candidate(value, score, match.range.first)
            }
        }
        return candidates
            .filter { it.amount > 0.0 }
            .sortedWith(compareByDescending<Candidate> { it.score }.thenBy { it.position })
            .firstOrNull()
            ?.amount
    }

    private fun inferCategory(content: String): String? {
        return categoryRules.entries.firstOrNull { (_, keywords) ->
            keywords.any { content.contains(it, ignoreCase = true) }
        }?.key
    }

    private fun inferPaymentChannel(source: String, content: String): String {
        return when (source.lowercase(Locale.ROOT)) {
            "wechat" -> "微信支付"
            "alipay" -> "支付宝"
            "pinduoduo" -> "拼多多"
            "meituan" -> "美团支付"
            "taobao" -> "淘宝支付"
            "jd" -> "京东支付"
            "eleme" -> "饿了么支付"
            "bank_sms", "bank_app" -> when {
                content.contains("财付通") -> "财付通"
                content.contains("支付宝") -> "支付宝"
                content.contains("微信支付") -> "微信支付"
                content.contains("云闪付") -> "云闪付"
                content.contains("京东支付") -> "京东支付"
                else -> "银行卡"
            }
            else -> sourceLabel(source)
        }
    }

    /**
     * 优先从单个通知字段提取交易对象，避免把拼接后的标题、金额和重复文案一起存入。
     * 无法可靠提取时返回 null，由界面明确显示“交易对象未提供”。
     */
    private fun extractCounterparty(data: PaymentNotificationContent, source: String): String? {
        val directPatterns = when (source.lowercase(Locale.ROOT)) {
            "wechat" -> listOf(
                Regex("""(?:付款给|支付给|转账给|向)\s*([^，,。；;\n]{2,80})"""),
                Regex("""(?:收款方|交易对象|交易对方|商户(?:名称)?|商家|收款人)\s*[：:]\s*([^，,。；;\n]{2,80})"""),
                providerMerchantPattern()
            )
            "alipay" -> listOf(
                Regex("""(?:付款给|支付给|转账给|向)\s*([^，,。；;\n]{2,80})"""),
                Regex("""(?:收款方|交易对象|交易对方|商户(?:名称)?|商家|收款人)\s*[：:]\s*([^，,。；;\n]{2,80})"""),
                providerMerchantPattern()
            )
            "bank_sms", "bank_app" -> listOf(
                Regex("""(?:支出|消费)\s*[（(]([^()（）]+)[)）]"""),
                Regex("""(?:付款给|支付给|转账给|收款方|交易对象|交易对方|商户(?:名称)?|商家|收款人)\s*[：:]\s*([^，,。；;\n]{2,80})"""),
                providerMerchantPattern(),
                Regex("""(?:消费于|在)\s*([^，,。；;\n]{2,60})\s*(?:消费|支付|完成交易)""")
            )
            else -> listOf(
                Regex("""(?:付款给|支付给|转账给|收款方|交易对象|交易对方|商户(?:名称)?|商家|收款人)\s*[：:]\s*([^，,。；;\n]{2,80})"""),
                Regex("""(?:支出|消费)\s*[（(]([^()（）]+)[)）]"""),
                providerMerchantPattern(),
                Regex("""(?:消费于|在)\s*([^，,。；;\n]{2,60})\s*(?:消费|支付|完成交易)""")
            )
        }

        data.contentParts().forEach { part ->
            directPatterns.forEach { pattern ->
                val captured = pattern.find(part)?.groupValues?.getOrNull(1)
                sanitizeCounterparty(captured)?.let { return it }
            }
        }

        if (source == "pinduoduo") {
            return "拼多多平台商户"
        }
        return null
    }

    private fun providerMerchantPattern() = Regex(
        """(?:财付通|微信支付|支付宝|美团支付|云闪付|京东支付|快捷支付)\s*[-－—:：]\s*([^，,。；;()（）\n]{2,80})"""
    )

    /** 无法取得商户时保留一条去金额、余额和模板词后的简短交易摘要。 */
    private fun extractSummary(
        data: PaymentNotificationContent,
        source: String,
        paymentChannel: String
    ): String {
        val ignoredParts = setOf(
            "微信支付", "支付宝", "支付助手", "交易提醒", "账单", "订单通知", "动账通知"
        )
        val candidate = data.contentParts()
            .asSequence()
            .filterNot { it.trim() in ignoredParts }
            .map(::sanitizeSummary)
            .firstOrNull { it.length >= 2 }

        return candidate ?: "${sourceLabel(source)}自动记账 · $paymentChannel"
    }

    private fun sanitizeSummary(value: String): String {
        return value
            .replace(Regex("""(?:人民币|RMB|CNY|¥|￥)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*元"""), "")
            .replace(Regex("""[，,。；;]?\s*(?:账户)?(?:余额|可用余额|可用额度)[:：]?\s*.*$"""), "")
            .replace(Regex("""(?:支付成功|付款成功|成功付款|成功支付|已支付|已付款|扣款成功|已扣款)\s*[：:]?"""), "")
            .trim(' ', '-', '－', '—', '：', ':', '，', ',', '。')
            .take(80)
    }

    private fun sanitizeCounterparty(value: String?): String? {
        if (value.isNullOrBlank()) return null

        val cleaned = value
            .trim()
            .replace(Regex("""^(?:消费|支出|快捷支付)\s*"""), "")
            .replace(Regex("""^(?:财付通|支付宝|微信支付|美团支付|云闪付|京东支付|快捷支付)\s*[-－—:：]\s*"""), "")
            .replace(Regex("""\s*(?:(?:人民币|RMB|CNY|¥|￥)\s*)?[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*元(?:\s*.*)?$""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""[，,。；;]\s*(?:余额|可用余额|账户余额).*$"""), "")
            .trim(' ', '-', '－', '—', '：', ':')
            .take(200)

        val ignored = listOf(
            "微信支付", "支付宝", "财付通", "美团支付", "快捷支付", "支付助手", "交易提醒",
            "订单通知", "动账通知", "付款成功", "支付成功", "扣款成功"
        )
        return cleaned.takeIf { it.length >= 2 && it !in ignored }
    }

    private fun sanitizeKeywords(keywords: List<String>): List<String> {
        return keywords.map(String::trim).filter { it.length >= 2 }
    }

    private fun containsAny(content: String, keywords: List<String>): Boolean {
        return keywords.any { it.isNotBlank() && content.contains(it, ignoreCase = true) }
    }

    private fun sourceLabel(source: String): String = when (source.lowercase(Locale.ROOT)) {
        "wechat" -> "微信支付"
        "alipay" -> "支付宝"
        "pinduoduo" -> "拼多多"
        "meituan" -> "美团"
        "taobao" -> "淘宝"
        "jd" -> "京东"
        "eleme" -> "饿了么"
        "bank_sms" -> "银行卡短信"
        "bank_app" -> "银行应用"
        else -> "电子支付"
    }
}

data class PaymentNotificationContent(
    val packageName: String,
    val title: String = "",
    val titleBig: String = "",
    val text: String = "",
    val subText: String = "",
    val summaryText: String = "",
    val bigText: String = "",
    val infoText: String = "",
    val tickerText: String = "",
    val channelId: String = ""
) {
    fun contentParts(): List<String> {
        return listOf(bigText, text, tickerText, summaryText, infoText, titleBig, subText, title)
            .map(String::trim)
            .filter(String::isNotBlank)
            .distinct()
    }

    fun allContent(): String {
        return contentParts().joinToString(" ")
    }
}

data class PaymentMatch(
    val amount: Double,
    val source: String,
    val categoryHint: String?,
    val description: String,
    val paymentChannel: String,
    val counterparty: String?
)
