package com.litenote.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class PaymentNotificationParserTest {

    @Test
    fun `默认监听只包含微信和支付宝`() {
        assertEquals(
            setOf(
                PaymentNotificationParser.WECHAT_PACKAGE,
                PaymentNotificationParser.ALIPAY_PACKAGE
            ),
            PaymentNotificationParser.DEFAULT_SUPPORTED_PACKAGES
        )
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
    fun `银行卡入账短信不会记为支出`() {
        val result = PaymentNotificationParser.parse(
            PaymentNotificationContent(
                packageName = "com.hihonor.mms",
                title = "95588",
                text = "您尾号1234账户收入人民币500.00元，已到账。"
            )
        )

        assertNull(result)
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
}
