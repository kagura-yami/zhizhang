package com.zhizhang.notification

import java.util.Calendar
import java.util.Locale

/**
 * 从通知中解析可自动入账的收入或支出。
 *
 * 识别策略采用 fail-closed：必须同时满足可信来源、明确支出语义和有效金额，
 * 普通聊天里单独出现“支付”“100 元”等字样不会触发。
 */
object PaymentNotificationParser {
    const val RULE_VERSION = "2026-09-16.2"

    /** 留存支付相关的拒绝样本，但不收集个人聊天或验证码。 */
    fun shouldArchive(data: PaymentNotificationContent): Boolean {
        val content = data.allContent()
        if (content.contains("验证码") || content.contains("动态密码")) return false
        val trusted = when (data.packageName) {
            WECHAT_PACKAGE -> listOf(data.title, data.titleBig, data.subText).any { it.contains("微信支付") || it.contains("支付助手") } || content.contains("微信支付凭证")
            in SMS_PACKAGES -> parseBankSms(data, content, emptyList()) != null
            in BANK_APP_PACKAGES -> parseBankApp(data, content, emptyList()) != null
            else -> data.packageName in setOf(ALIPAY_PACKAGE, PINDUODUO_PACKAGE, MEITUAN_PACKAGE, TAOBAO_PACKAGE, JD_PACKAGE, ELEME_PACKAGE)
        }
        return trusted && containsAny(content, outgoingKeywords + incomingKeywords + listOf("优惠券", "红包", "余额", "交易", "满减"))
    }

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
        ALIPAY_PACKAGE,
        // 工行等银行 App 会直接发布“动账通知”，不是短信进程；默认纳入可避免漏记。
        ICBC_PACKAGE
    ) + SMS_PACKAGES

    val KNOWN_SUPPORTED_PACKAGES = setOf(
        WECHAT_PACKAGE,
        ALIPAY_PACKAGE,
        PINDUODUO_PACKAGE
    ) + SMS_PACKAGES + BANK_APP_PACKAGES

    private val outgoingKeywords = listOf(
        "消费", "支出", "扣款", "扣费", "扣除", "扣账", "代扣", "支付", "付款", "转出", "转账",
        "快捷支付", "付款码支付", "付款码付款", "自动扣款", "自动扣费", "免密支付", "免密扣款",
        "交易金额", "消费金额", "支出金额", "扣款金额", "刷卡"
    )

    private val incomingKeywords = listOf(
        "收款", "收款到账", "收款成功", "入账", "收入", "转入", "存入", "到账", "工资", "奖金", "红包",
        "退款", "退货退款", "返还", "充值到账"
    )

    private val explicitExpenseKeywords = listOf(
        "支出", "消费", "扣款", "扣费", "扣除", "扣账", "代扣", "转出", "付款成功",
        "支付成功", "已支付", "已付款", "付款码支付成功", "付款码付款成功", "自动扣款成功",
        "自动扣费成功", "免密支付成功", "免密扣款成功", "刷卡", "快捷支付"
    )

    private val amountPatterns = listOf(
        // 银行短信常见格式：支出 6.80、交易金额：6.80，可能没有货币符号或“元”。
        Regex("""(?:(?:交易|消费|支出|扣款)?金额|(?:消费|支出|扣款|扣费|扣除|扣账|代扣|转出|付款|付款码支付|付款码付款|自动扣款|自动扣费|免密支付|免密扣款|支付|刷卡))\s*[：:=\-－—]?\s*[-−－]?\s*(?:人民币|RMB|CNY|¥|￥)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE),
        Regex("""[-−－]?\s*(?:人民币|RMB|CNY|¥|￥)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE),
        Regex("""([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*元"""),
        Regex("""(?:收款|收入|入账|转入|存入|到账|工资|奖金|红包|退款|返还)\s*[：:=\-－—]?\s*(?:人民币|RMB|CNY|¥|￥)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE),
        Regex(
            """(?:支付成功|付款成功|成功付款|成功支付|已支付|已付款|付款码支付成功|付款码付款成功|扣款成功|扣费成功|自动扣款成功|自动扣费成功|免密支付成功|免密扣款成功|已扣款|已扣费|实付)\s*[：:]?\s*[-−－]?\s*(?:人民币|RMB|CNY|¥|￥)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"""
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
            "话费", "通信缴费", "缴费", "中国移动", "中国联通", "中国电信"
        ),
        "娱乐" to listOf(
            "游戏充值", "游戏", "电影票", "电影院", "影院", "视频会员", "音乐会员", "会员续费",
            "会员充值", "KTV", "演出", "门票", "娱乐", "爱奇艺", "腾讯视频", "哔哩哔哩"
        ),
        "购物" to listOf(
            "拼多多", "淘宝", "天猫", "京东", "唯品会", "苏宁", "抖音商城", "快手小店",
            "盒马", "山姆", "沃尔玛", "永辉", "便利店", "超市", "商场", "商城", "购物",
            "商店", "小铺", "门店", "快递", "电商", "零售"
        )
    )

    fun parse(data: PaymentNotificationContent, customKeywords: List<String> = emptyList()): PaymentMatch? {
        val content = data.allContent()
        if (content.isBlank()) {
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
        // “收款/到账”优先作为收入；只有同时出现明确的扣款/消费语义时才判为支出。
        // 不把“支付方”“转账”这类上下文词当作支出，避免银行入账通知被漏掉。
        val isRefund = containsAny(content, listOf("退款成功", "退款到账", "退款已到账", "已退款", "退货退款成功", "原路退回", "款项退回", "已返还")) &&
            !containsAny(content, listOf("退款到账说明", "退款说明"))
        val isIncome = isRefund || (containsAny(content, incomingKeywords) && !containsAny(content, explicitExpenseKeywords))
        val categoryHint = if (isIncome) {
            if (isRefund) "退款" else inferIncomeCategory(categoryContent)
        } else if (data.packageName == PINDUODUO_PACKAGE) {
            "购物"
        } else {
            inferCategory(categoryContent)
        }
        val summary = counterparty ?: extractSummary(data, source, paymentChannel, isIncome, categoryHint == "退款")
        val transactionRef = extractTransactionRef(content)
        val cardTail = extractCardTail(content)
        val balance = extractBalance(content)
        val occurredAt = extractOccurredAt(content)

        return PaymentMatch(
            amount = amount,
            source = source,
            categoryHint = categoryHint,
            description = summary,
            paymentChannel = paymentChannel,
            counterparty = counterparty,
            type = if (isIncome) "income" else "expense",
            transactionRef = transactionRef,
            cardTail = cardTail,
            balance = balance,
            occurredAt = occurredAt
        )
    }

    /** 从通知正文提取银行/支付方写入的实际交易时间，避免使用延迟到达时间。 */
    private fun extractOccurredAt(content: String): Long? {
        val patterns = listOf(
            Regex("""(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日[^\d]{0,8}(\d{1,2}):(\d{2})"""),
            Regex("""(\d{1,2})月\s*(\d{1,2})日[^\d]{0,8}(\d{1,2}):(\d{2})"""),
            Regex("""(20\d{2})[-/]\s*(\d{1,2})[-/]\s*(\d{1,2})[^\d]{0,8}(\d{1,2}):(\d{2})""")
        )
        for ((index, pattern) in patterns.withIndex()) {
            val match = pattern.find(content) ?: continue
            try {
                val year: Int
                val month: Int
                val day: Int
                val hour: Int
                val minute: Int
                if (index == 1) {
                    year = Calendar.getInstance().get(Calendar.YEAR)
                    month = match.groupValues[1].toInt()
                    day = match.groupValues[2].toInt()
                    hour = match.groupValues[3].toInt()
                    minute = match.groupValues[4].toInt()
                } else {
                    year = match.groupValues[1].toInt()
                    month = match.groupValues[2].toInt()
                    day = match.groupValues[3].toInt()
                    hour = match.groupValues[4].toInt()
                    minute = match.groupValues[5].toInt()
                }
                if (month !in 1..12 || day !in 1..31 || hour !in 0..23 || minute !in 0..59) continue
                return Calendar.getInstance().apply {
                    set(Calendar.YEAR, year)
                    set(Calendar.MONTH, month - 1)
                    set(Calendar.DAY_OF_MONTH, day)
                    set(Calendar.HOUR_OF_DAY, hour)
                    set(Calendar.MINUTE, minute)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                }.timeInMillis
            } catch (_: NumberFormatException) {
                // 继续尝试其他格式
            }
        }
        return null
    }

    private fun parseWechat(
        data: PaymentNotificationContent,
        content: String,
        customKeywords: List<String>
    ): String? {
        val officialIdentity = listOf(data.title, data.titleBig, data.subText).any {
            it.contains("微信支付") || it.contains("支付助手")
        } || content.contains("微信支付凭证")

        val strongAction = containsAny(content, listOf("支付成功", "付款成功", "扣款成功", "扣费成功", "交易成功", "已支付", "已扣费") + sanitizeKeywords(customKeywords)) ||
            containsAny(content, incomingKeywords)
        return if (officialIdentity && strongAction) "wechat" else null
    }

    private fun parseAlipay(
        data: PaymentNotificationContent,
        content: String,
        customKeywords: List<String>
    ): String? {
        // 该分支只由支付宝包名进入，包名本身就是最可靠的来源标识。
        // 部分版本会把商户名（如“高德打车订单”）放在标题并完全省略“支付宝”，
        // 若仍要求正文带“支付宝”会漏掉自动扣款和付款码通知。
        val officialIdentity = true

        val successAction = containsAny(content, listOf(
            "支付成功", "付款成功", "成功付款", "成功支付", "已支付", "已付款",
            "付款码支付成功", "付款码付款成功", "扣款成功", "扣费成功", "自动扣款成功",
            "自动扣费成功", "免密支付成功", "免密扣款成功", "已扣款", "已扣费", "交易成功"
        ))
        val action = successAction || containsAny(
            content,
            listOf("付款码支付", "付款码付款", "自动扣款", "自动扣费", "免密支付", "免密扣款", "支出", "消费金额", "扣款金额") +
                sanitizeKeywords(customKeywords)
        )
        val looksLikeAd = containsAny(content, listOf("优惠", "立减", "返现", "最高", "低至", "活动"))
        // 优惠红包不是资金入账；“券到账”与到期/领取提醒也不能绕过广告过滤。
        // 已完成的付款可能附带优惠说明，仍保留原有支出识别。
        val promotionalIncome = containsAny(content, listOf(
            "优惠", "立减", "满减", "最高", "低至", "活动", "无门槛", "券", "卡包",
            "失效", "到期", "过期", "待领取", "待使用", "去领取", "立即领取", "可领取", "领取红包"
        ))
        val receivedCashRedPacket = Regex("""(?:收到|收到了|已领取|领取了).{0,16}红包|红包.{0,16}(?:已到账|已入账|已存入余额)""")
            .containsMatchIn(content)
        val incomeAction = containsAny(content, incomingKeywords.filterNot { it == "红包" }) || receivedCashRedPacket
        val thresholdOffer = Regex("""满\s*\d+(?:\.\d+)?\s*(?:元)?\s*减""").containsMatchIn(content)
        val strongAction = successAction || (!promotionalIncome && !thresholdOffer && ((action && !looksLikeAd) || incomeAction))
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
            listOf("银行", "信用卡", "储蓄卡", "借记卡", "尾号", "账户", "卡号", "工商", "建设", "招商", "农业", "中国银行")
        ) || Regex("""^[0-9]{4,6}$""").matches(title)

        val transactionAction = containsAny(content, outgoingKeywords + incomingKeywords + listOf("交易") + sanitizeKeywords(customKeywords))
        return if (bankIdentity && transactionAction) "bank_sms" else null
    }

    private fun parseBankApp(
        data: PaymentNotificationContent,
        content: String,
        customKeywords: List<String>
    ): String? {
        val bankIdentity = listOf(data.title, data.titleBig, data.subText).any {
            containsAny(it, listOf("工商银行", "动账通知", "交易提醒"))
        } || containsAny(content, listOf("工商银行", "尾号", "动账通知"))

        val transactionAction = containsAny(
            content,
            outgoingKeywords + incomingKeywords + listOf("交易") +
                sanitizeKeywords(customKeywords)
        )
        return if (bankIdentity && transactionAction) "bank_app" else null
    }

    private fun extractAmount(content: String): Double? {
        data class Candidate(val amount: Double, val score: Int, val position: Int)

        val candidates = mutableListOf<Candidate>()
        amountPatterns.forEach { pattern ->
            pattern.findAll(content).forEach { match ->
                val value = match.groupValues[1].replace(",", "").toDoubleOrNull() ?: return@forEach
                val amountStart = match.groups[1]!!.range.first
                val before = content.substring(0, amountStart)
                val prefix = before.substringAfterLast('，').substringAfterLast(',')
                    .substringAfterLast('。').substringAfterLast('；').substringAfterLast('\n').takeLast(60)
                // 只检查金额前的同一分句，后面的余额或优惠不能改变交易金额评分。
                val context = prefix
                var score = 0
                if (containsAny(context, listOf("余额", "可用额度", "优惠", "立减", "抵扣", "原价", "已使用"))) return@forEach
                if (containsAny(match.value.substringBefore(match.groupValues[1]), outgoingKeywords + incomingKeywords)) score += 10
                if (containsAny(context, outgoingKeywords)) score += 5
                if (containsAny(context, incomingKeywords)) score += 5
                if (containsAny(context, listOf("余额", "可用额度", "可用余额", "账户余额"))) score -= 8
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
                Regex("""(?:收款方|交易对象|交易对方|商户(?:名称)?|商家|收款人|付款方|来自)\s*[：:]\s*([^，,。；;\n]{2,80})"""),
                providerMerchantPattern()
            )
            "alipay" -> listOf(
                Regex("""(?:付款给|支付给|转账给|向)\s*([^，,。；;\n]{2,80})"""),
                Regex("""(?:收款方|交易对象|交易对方|商户(?:名称)?|商家|收款人|付款方|来自)\s*[：:]\s*([^，,。；;\n]{2,80})"""),
                providerMerchantPattern()
            )
            "bank_sms", "bank_app" -> listOf(
                Regex("""(?:支出|消费)\s*[（(]([^()（）]+)[)）]"""),
                Regex("""(?:收入|入账|转入|收款)\s*[（(]([^()（）]+)[)）]"""),
                Regex("""(?:消费支付|快捷支付|消费|支出)\s*[-－—:：]?\s*([^，,。；;()（）\n]{2,80})"""),
                Regex("""(?:付款给|支付给|转账给|收款方|交易对象|交易对方|商户(?:名称)?|商家|收款人|付款方|来自)\s*[：:]\s*([^，,。；;\n]{2,80})"""),
                providerMerchantPattern(),
                Regex("""(?:消费于|在)\s*([^，,。；;\n]{2,60})\s*(?:消费|支付|完成交易)""")
            )
            else -> listOf(
                Regex("""(?:付款给|支付给|转账给|收款方|交易对象|交易对方|商户(?:名称)?|商家|收款人|付款方|来自)\s*[：:]\s*([^，,。；;\n]{2,80})"""),
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
        paymentChannel: String,
        isIncome: Boolean,
        isRefund: Boolean
    ): String {
        val content = data.allContent()
        val channel = if (containsAny(content, listOf("财付通", "微信"))) "微信" else paymentChannel
        if (isRefund) return "${channel}退款"
        if (containsAny(content, listOf("充值财付通", "充值微信", "微信零钱充值"))) return "微信零钱充值"
        if (containsAny(content, listOf("转账财付通", "微信转账"))) return "${channel}转账"
        val ignoredParts = setOf(
            "微信支付", "支付宝", "支付助手", "交易提醒", "账单", "订单通知", "动账通知"
        )
        val candidate = data.contentParts()
            .asSequence()
            .filterNot { it.trim() in ignoredParts }
            .map(::sanitizeSummary)
            .filter { it.length in 2..60 }
            .filterNot(::looksLikeNotificationTemplate)
            .firstOrNull()

        if (isIncome) return candidate ?: "${channel}收款"
        return candidate ?: when (source.lowercase(Locale.ROOT)) {
            "wechat" -> "微信支付消费"
            "alipay" -> "支付宝消费"
            "bank_sms" -> "银行卡消费"
            "bank_app" -> "银行消费"
            else -> "${sourceLabel(source)}消费"
        }
    }

    private fun inferIncomeCategory(content: String): String? {
        return when {
            listOf("工资", "薪资", "发薪", "代发").any { content.contains(it, ignoreCase = true) } -> "工资"
            listOf("奖金", "绩效", "年终奖").any { content.contains(it, ignoreCase = true) } -> "奖金"
            listOf("退款", "退货退款", "返还").any { content.contains(it, ignoreCase = true) } -> "退款"
            listOf("利息", "理财", "分红", "投资").any { content.contains(it, ignoreCase = true) } -> "投资"
            listOf("红包", "转账", "收款").any { content.contains(it, ignoreCase = true) } -> "其他收入"
            else -> null
        }
    }

    /** 提取订单号/交易号/流水号等稳定标识，用于跨通知去重。 */
    private fun extractTransactionRef(content: String): String? {
        val labels = "订单号|订单编号|交易号|交易编号|流水号|交易流水号|商户订单号|支付订单号|支付流水号|参考号|凭证号"
        val match = Regex("(?:$labels)\\s*[：:#]?\\s*([A-Za-z0-9_-]{6,64})", RegexOption.IGNORE_CASE).find(content)
        return match?.groupValues?.getOrNull(1)?.takeIf { it.any(Char::isDigit) }
    }

    /** 提取银行卡尾号，银行短信与支付通知可用来确认是否同一账户交易。 */
    private fun extractCardTail(content: String): String? {
        return Regex("(?:尾号|卡号|卡)\\s*[：:]?\\s*(?:[*xXＸ]{0,4})?(\\d{3,6})").find(content)
            ?.groupValues?.getOrNull(1)
    }

    /** 提取余额字段，仅作为辅助证据，不参与金额识别。 */
    private fun extractBalance(content: String): Double? {
        val amount = "([0-9][0-9,]*(?:\\.[0-9]{1,2})?)"
        val match = Regex("(?:账户|可用|剩余)?余额\\s*[：:]?\\s*(?:人民币|RMB|CNY|¥|￥)?\\s*$amount", RegexOption.IGNORE_CASE).find(content)
        return match?.groupValues?.getOrNull(1)?.replace(",", "")?.toDoubleOrNull()
    }

    /** 过滤号码、余额和银行固定模板，避免通知原文污染账单摘要。 */
    private fun looksLikeNotificationTemplate(value: String): Boolean {
        if (Regex("^[0-9+()（） -]{5,}$").matches(value)) return true
        return containsAny(
            value,
            listOf("余额", "可用额度", "账户", "尾号", "验证码", "请点击", "客服电话", "还款日")
        )
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
            .replace(Regex("""^(?:消费|支出|快捷支付|转账|充值|退款)\s*"""), "")
            .replace(Regex("""^(?:收入|入账|转入|收款)\s*"""), "")
            .replace(Regex("""^(?:消费支付通|消费支付|快捷支付通|支付通)\s*[-－—:：]?\s*"""), "")
            .replace(Regex("""^(?:财付通|支付宝|微信支付|微信|美团支付|美团|云闪付|京东支付|快捷支付)\s*[-－—:：]\s*"""), "")
            .replace(Regex("""\s*(?:(?:人民币|RMB|CNY|¥|￥)\s*)?[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*元(?:\s*.*)?$""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""[，,。；;]\s*(?:余额|可用余额|账户余额).*$"""), "")
            .trim(' ', '-', '－', '—', '：', ':')
            .take(200)

        val ignored = listOf(
            "微信支付", "支付宝", "财付通", "美团支付", "快捷支付", "支付助手", "交易提醒",
            "订单通知", "动账通知", "付款成功", "支付成功", "扣款成功", "微信转账", "转账", "充值", "退款", "零钱充值"
        )
        // “已支付¥17.98”只是动作与金额，不是商户。把它误当交易对象会让
        // 微信通知与随后到达的银行通知因“商户冲突”无法合并。
        val actionOnly = Regex(
            """^(?:已)?(?:支付|付款|扣款|扣费|实付|消费)(?:成功)?\s*(?:人民币|RMB|CNY|¥|￥)?\s*[0-9,.]+(?:元)?$""",
            RegexOption.IGNORE_CASE
        ).matches(cleaned)
        return cleaned.takeIf { it.length >= 2 && it !in ignored && !actionOnly }
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
    val channelId: String = "",
    val textLines: List<String> = emptyList()
) {
    fun contentParts(): List<String> {
        return (listOf(bigText, text) + textLines + listOf(tickerText, summaryText, infoText, titleBig, subText, title))
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
    val counterparty: String?,
    val type: String = "expense",
    val transactionRef: String? = null,
    val cardTail: String? = null,
    val balance: Double? = null,
    /** 正文中明确写出的交易发生时间（毫秒）；为空时由通知发布时间兜底。 */
    val occurredAt: Long? = null
)
