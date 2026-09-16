package com.zhizhang.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.util.Calendar

class PaymentNotificationParserTest {
    @Test
    fun `留档包含优惠拒绝样本但排除聊天和验证码`() {
        assertEquals(true, PaymentNotificationParser.shouldArchive(PaymentNotificationContent(
            packageName = PaymentNotificationParser.ALIPAY_PACKAGE, title = "支付宝卡包", text = "你有5元红包今晚失效"
        )))
        assertEquals(false, PaymentNotificationParser.shouldArchive(PaymentNotificationContent(
            packageName = PaymentNotificationParser.WECHAT_PACKAGE, title = "张三", text = "收到5元红包了吗"
        )))
        assertEquals(false, PaymentNotificationParser.shouldArchive(PaymentNotificationContent(
            packageName = PaymentNotificationParser.ALIPAY_PACKAGE, title = "支付宝", text = "付款验证码123456，金额5元"
        )))
    }
    @Test
    fun `银行转账充值退款的渠道模板不作为交易对象`() {
        for ((action, summary) in listOf("转账" to "微信转账", "充值" to "微信零钱充值", "退款" to "微信退款")) {
            val income = action == "退款"
            val result = PaymentNotificationParser.parse(PaymentNotificationContent(
                packageName = PaymentNotificationParser.ICBC_PACKAGE,
                title = "工商银行",
                text = "尾号3343卡${if (income) "收入" else "支出"}(${action}财付通-${if (income) "财付通" else "微信转账"})111.32元，余额500.00元"
            ))
            assertNotNull(result)
            assertNull(result!!.counterparty)
            assertEquals(summary, result.description)
            assertEquals(111.32, result.amount, 0.001)
            assertEquals(if (income) "income" else "expense", result.type)
            assertEquals(if (income) "退款" else null, result.categoryHint)
        }
    }

    @Test
    fun `金额优先实际交易而非余额原价或优惠`() {
        for (text in listOf(
            "账户余额900元，支出18.50元，余额881.50元",
            "原价100元，支付成功85元，优惠15元",
            "支付成功85元，已使用15元优惠券"
        )) {
            val result = PaymentNotificationParser.parse(PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE, title = "支付宝", text = text
            ))
            assertNotNull(text, result)
            assertEquals(if (text.startsWith("账户")) 18.5 else 85.0, result!!.amount, 0.001)
        }
    }

    @Test
    fun `满减红包即使配置了消费关键词也不记账`() {
        assertNull(PaymentNotificationParser.parse(PaymentNotificationContent(
            packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
            title = "支付宝", text = "你有淘宝闪购满25减14元红包，消费可用"
        ), listOf("消费")))
    }

    @Test
    fun `话费充值仍归居住而普通充值不猜分类`() {
        for (text in listOf("支付成功20元，话费充值", "支付成功20元，余额充值")) {
            val result = PaymentNotificationParser.parse(PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE, title = "支付宝", text = text
            ))
            assertNotNull(result)
            assertEquals(if (text.contains("话费")) "居住" else null, result!!.categoryHint)
        }
    }

    @Test
    fun `支付宝优惠红包和券提醒不能记为收入`() {
        val reminders = listOf(
            "你有淘宝闪购无门槛5元红包今晚失效",
            "5元优惠券已到账",
            "收到5元消费红包，立即领取",
            "你的5元红包即将到期",
            "5元红包待领取",
            "红包5元",
            "恭喜获得5元无门槛红包"
        )
        for (text in reminders) {
            assertNull(text, PaymentNotificationParser.parse(PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "支付宝",
                text = text
            )))
        }
        assertNull(PaymentNotificationParser.parse(PaymentNotificationContent(
            packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
            title = "支付宝卡包",
            bigText = reminders.first()
        ), listOf("红包")))
    }

    @Test
    fun `支付宝真实收款退款和现金红包仍能识别`() {
        for (text in listOf("收款到账5.00元", "退款成功5.00元", "收到张三的5元红包", "红包5元已存入余额")) {
            val result = PaymentNotificationParser.parse(PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "支付宝",
                text = text
            ))
            assertNotNull(text, result)
            assertEquals("income", result!!.type)
            assertEquals(5.0, result.amount, 0.001)
        }
    }

    @Test
    fun `支付宝付款附带优惠券说明仍按实际付款记账`() {
        val result = PaymentNotificationParser.parse(PaymentNotificationContent(
            packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
            title = "支付宝",
            text = "支付成功15.00元，已使用5元优惠券"
        ))
        assertNotNull(result)
        assertEquals("expense", result!!.type)
        assertEquals(15.0, result.amount, 0.001)
    }

    @Test
    fun `默认监听包含微信支付宝和短信`() {
        assertEquals(
            setOf(
                PaymentNotificationParser.WECHAT_PACKAGE,
                PaymentNotificationParser.ALIPAY_PACKAGE,
                PaymentNotificationParser.ICBC_PACKAGE
            ) + PaymentNotificationParser.SMS_PACKAGES,
            PaymentNotificationParser.DEFAULT_SUPPORTED_PACKAGES
        )
    }

    @Test
    fun `工商银行动账通知默认可识别并提取商户`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ICBC_PACKAGE,
                title = "动账通知",
                text = "尾号3343卡8月29日08:16支出(消费财付通-拼多多平台商户)6.80元。请点击查看详情。"
            )
        )

        assertNotNull(result)
        assertEquals(6.8, result!!.amount, 0.001)
        assertEquals("bank_app", result.source)
        assertEquals("拼多多平台商户", result.counterparty)
        assertEquals("购物", result.categoryHint)
    }

    @Test
    fun `普通微信聊天包含支付金额时不触发`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.WECHAT_PACKAGE,
                title = "张三",
                text = "张三: 支付100元"
            )
        )

        assertNull(result)
    }

    @Test
    fun `微信支付官方通知可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.WECHAT_PACKAGE,
                title = "微信支付",
                text = "付款成功 ¥100.00"
            )
        )

        assertNotNull(result)
        assertEquals(100.0, result!!.amount, 0.001)
        assertEquals("wechat", result.source)
        assertEquals("微信支付", result.paymentChannel)
    }

    @Test
    fun `微信动作金额不应误判为交易对象`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.WECHAT_PACKAGE,
                title = "微信支付",
                text = "已支付¥17.98"
            )
        )

        assertNotNull(result)
        assertNull(result!!.counterparty)
        assertEquals("微信支付消费", result.description)
    }

    @Test
    fun `微信支付已扣费通知可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.WECHAT_PACKAGE,
                title = "微信支付",
                text = "已扣费¥15.39"
            )
        )

        assertNotNull(result)
        assertEquals(15.39, result!!.amount, 0.001)
        assertEquals("wechat", result.source)
    }

    @Test
    fun `支付宝扫码成功付款通知可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "支付助手",
                text = "成功付款916.00元",
                bigText = "付款给手插裤袋没人爱(**娃)"
            )
        )

        assertNotNull(result)
        assertEquals(916.0, result!!.amount, 0.001)
        assertEquals("alipay", result.source)
        assertEquals("手插裤袋没人爱(**娃)", result.counterparty)
        assertEquals("支付宝", result.paymentChannel)
    }

    @Test
    fun `支付宝成功付款省略货币单位也可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "支付宝",
                text = "已成功付款：15.20"
            )
        )

        assertNotNull(result)
        assertEquals(15.2, result!!.amount, 0.001)
        assertEquals("alipay", result.source)
    }

    @Test
    fun `支付宝付款码支付带负号金额可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "支付宝",
                text = "付款码支付成功 -¥11.00"
            )
        )

        assertNotNull(result)
        assertEquals(11.0, result!!.amount, 0.001)
        assertEquals("alipay", result.source)
        assertEquals("expense", result.type)
    }

    @Test
    fun `支付宝自动扣款金额可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "支付宝服务提醒",
                text = "自动扣款成功",
                bigText = "高德打车订单，扣款金额：5.36元"
            )
        )

        assertNotNull(result)
        assertEquals(5.36, result!!.amount, 0.001)
        assertEquals("alipay", result.source)
        assertEquals("交通", result.categoryHint)
    }

    @Test
    fun `支付宝商户标题省略支付宝字样仍可识别自动扣款`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "高德打车订单",
                text = "自动扣款成功 -5.36元"
            )
        )

        assertNotNull(result)
        assertEquals(5.36, result!!.amount, 0.001)
        assertEquals("alipay", result.source)
    }

    @Test
    fun `支付宝扫码优惠广告不会触发`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "支付宝",
                text = "扫码付款享优惠，最高立减99元"
            )
        )

        assertNull(result)
    }

    @Test
    fun `拼多多价格广告不会触发`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.PINDUODUO_PACKAGE,
                title = "百亿补贴",
                text = "爆款低至￥99.00"
            )
        )

        assertNull(result)
    }

    @Test
    fun `拼多多付款成功自动归类购物`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.PINDUODUO_PACKAGE,
                title = "订单通知",
                text = "订单付款成功，实付￥88.50"
            )
        )

        assertNotNull(result)
        assertEquals(88.5, result!!.amount, 0.001)
        assertEquals("购物", result.categoryHint)
    }

    @Test
    fun `美团已付款通知可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.MEITUAN_PACKAGE,
                title = "美团",
                text = "您已成功付款14.50元",
                bigText = "您的美团订单已支付成功，点击查看详情>"
            )
        )

        assertNotNull(result)
        assertEquals(14.5, result!!.amount, 0.001)
        assertEquals("meituan", result.source)
        assertEquals("美团支付", result.paymentChannel)
    }

    @Test
    fun `银行卡消费短信优先提取消费额而非余额`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.hihonor.mms",
                title = "95588",
                text = "您尾号1234卡消费人民币25.60元，账户余额人民币1,000.00元。"
            )
        )

        assertNotNull(result)
        assertEquals(25.6, result!!.amount, 0.001)
        assertEquals("bank_sms", result.source)
    }

    @Test
    fun `银行卡短信支出金额没有元字也可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.android.mms.service",
                title = "95588",
                text = "您尾号3343卡交易金额：6.80，交易类型为消费，余额100.00。"
            )
        )

        assertNotNull(result)
        assertEquals(6.8, result!!.amount, 0.001)
        assertEquals("bank_sms", result.source)
    }

    @Test
    fun `支出短信附带到账说明仍能识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.android.mms.service",
                title = "95588",
                text = "尾号3343卡支出18.90元，商户为铁路12306；退款到账说明请见银行客户端。"
            )
        )

        assertNotNull(result)
        assertEquals(18.9, result!!.amount, 0.001)
        assertEquals("交通", result.categoryHint)
    }

    @Test
    fun `系统短信服务进程的工商银行支出短信可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.android.mms.service",
                title = "95588",
                text = "尾号3343卡8月19日09:06支出(消费财付通-链动小铺)30.65元，余额4,635.32元。【工商银行】"
            )
        )

        assertNotNull(result)
        assertEquals(30.65, result!!.amount, 0.001)
        assertEquals("bank_sms", result.source)
        assertEquals("财付通", result.paymentChannel)
        assertEquals("链动小铺", result.counterparty)
    }

    @Test
    fun `银行卡入账短信识别为收入而非支出`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.hihonor.mms",
                title = "95588",
                text = "您尾号1234账户收入人民币500.00元，已到账。"
            )
        )

        assertNotNull(result)
        assertEquals("income", result!!.type)
    }

    @Test
    fun `退款成功识别为退款收入`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ALIPAY_PACKAGE,
                title = "支付宝",
                text = "退款成功，原路退回¥12.00"
            )
        )

        assertNotNull(result)
        assertEquals("income", result!!.type)
        assertEquals("退款", result.categoryHint)
    }

    @Test
    fun `支出通知中的退款到账说明不应被误判为退款收入`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.SMS_PACKAGES.first(),
                title = "95588",
                text = "卡支出12.00元，退款到账说明请见银行客户端。"
            )
        )

        assertNotNull(result)
        assertEquals("expense", result!!.type)
    }

    @Test
    fun `银行卡工资入账可以识别为收入`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.hihonor.mms",
                title = "95588",
                text = "您尾号1234卡收入人民币8000.00元，工资代发已入账，余额10000.00元。"
            )
        )

        assertNotNull(result)
        assertEquals(8000.0, result!!.amount, 0.001)
        assertEquals("bank_sms", result.source)
        assertEquals("income", result.type)
        assertEquals("工资", result.categoryHint)
    }

    @Test
    fun `微信收款通知可以识别为收入`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.WECHAT_PACKAGE,
                title = "微信支付",
                text = "收款到账 32.00元",
                bigText = "收款方：我"
            )
        )

        assertNotNull(result)
        assertEquals(32.0, result!!.amount, 0.001)
        assertEquals("wechat", result.source)
        assertEquals("income", result.type)
    }

    @Test
    fun `不同格式的收款通知可以提取付款方作为交易对象`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.WECHAT_PACKAGE,
                title = "微信支付",
                text = "收款到账 34.14元，来自：链动小铺"
            )
        )

        assertNotNull(result)
        assertEquals("income", result!!.type)
        assertEquals("链动小铺", result.counterparty)
    }

    @Test
    fun `工商银行短信优先提取正文实际交易时间`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.android.mms.service",
                title = "95588",
                text = "尾号3343卡8月31日16:10支出(消费财付通-链动万商科技)30.90元，余额4,045.68元。【工商银行】"
            )
        )

        assertNotNull(result)
        val calendar = Calendar.getInstance().apply { timeInMillis = result!!.occurredAt!! }
        assertEquals(Calendar.AUGUST, calendar.get(Calendar.MONTH))
        assertEquals(31, calendar.get(Calendar.DAY_OF_MONTH))
        assertEquals(16, calendar.get(Calendar.HOUR_OF_DAY))
        assertEquals(10, calendar.get(Calendar.MINUTE))
    }

    @Test
    fun `银行入账括号格式可以提取交易对象`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ICBC_PACKAGE,
                title = "工商银行",
                subText = "动账通知",
                text = "尾号3343卡收入(微信-链动小铺)34.14元，余额100.00元"
            )
        )

        assertNotNull(result)
        assertEquals("income", result!!.type)
        assertEquals("链动小铺", result.counterparty)
    }

    @Test
    fun `普通短信伪造支付文案不会触发`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.hihonor.mms",
                title = "张三",
                text = "支付成功100元"
            )
        )

        assertNull(result)
    }

    @Test
    fun `工商银行应用动账通知可以识别`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ICBC_PACKAGE,
                title = "工商银行",
                text = "尾号3343卡8月18日14:48支出(消费财付通-拼多多平台商户)15.39元，余额5,626.42元。",
                subText = "动账通知"
            )
        )

        assertNotNull(result)
        assertEquals(15.39, result!!.amount, 0.001)
        assertEquals("bank_app", result.source)
        assertEquals("购物", result.categoryHint)
        assertEquals("财付通", result.paymentChannel)
        assertEquals("拼多多平台商户", result.counterparty)
    }

    @Test
    fun `微信支付凭证可以提取收款方并归类餐饮`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.WECHAT_PACKAGE,
                title = "微信支付",
                text = "付款成功 ¥32.00",
                bigText = "收款方：星巴克咖啡"
            )
        )

        assertNotNull(result)
        assertEquals("星巴克咖啡", result!!.counterparty)
        assertEquals("餐饮", result.categoryHint)
        assertEquals("星巴克咖啡", result.description)
    }

    @Test
    fun `银行卡短信中的支付渠道和商户可以提取`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.android.mms",
                title = "95588",
                text = "尾号1234卡支出(美团支付-厦门三号餐厅)57.00元，余额100.00元"
            )
        )

        assertNotNull(result)
        assertEquals("厦门三号餐厅", result!!.counterparty)
        assertEquals("餐饮", result.categoryHint)
        assertEquals("银行卡", result.paymentChannel)
    }

    @Test
    fun `未受信任应用伪造银行动账通知不会触发`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.example.fake",
                title = "工商银行",
                text = "尾号3343卡支出15.39元"
            )
        )

        assertNull(result)
    }

    @Test
    fun `支付通知提取交易号卡尾号和余额辅助字段`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = PaymentNotificationParser.ICBC_PACKAGE,
                title = "工商银行",
                text = "尾号3343卡8月31日15:27支出(消费财付通-链动小铺)34.14元，余额4,500.00元，交易流水号：ABC202608311527001"
            )
        )

        assertNotNull(result)
        assertEquals("ABC202608311527001", result!!.transactionRef)
        assertEquals("3343", result.cardTail)
        assertEquals(4500.0, result.balance!!, 0.001)
        assertEquals("链动小铺", result.counterparty)
    }
}
