package com.zhizhang.shortcut

import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** 将关于页二维码链接交给微信处理，避免 ACTION_VIEW 被浏览器抢占。 */
class WechatLinkModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName(): String = "WechatLinkModule"

    @ReactMethod
    fun open(url: String, promise: Promise) {
        try {
            val packageManager = context.packageManager
            val wechatIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                setPackage("com.tencent.mm")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            if (wechatIntent.resolveActivity(packageManager) != null) {
                context.startActivity(wechatIntent)
                promise.resolve(true)
                return
            }

            // 某些微信版本不声明 https 链接过滤器，但仍支持官方扫码入口。
            val scanIntent = Intent(Intent.ACTION_VIEW, Uri.parse("weixin://dl/scan")).apply {
                setPackage("com.tencent.mm")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            if (scanIntent.resolveActivity(packageManager) != null) {
                context.startActivity(scanIntent)
                promise.resolve(true)
                return
            }
            promise.reject("WECHAT_NOT_FOUND", "未找到可处理该链接的微信，请先安装微信")
        } catch (error: Exception) {
            promise.reject("WECHAT_OPEN_FAILED", "无法打开微信", error)
        }
    }
}
