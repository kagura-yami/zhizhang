package com.zhizhang.utils

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.zhizhang.BuildConfig
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.zhizhang.utils.UpdateNotificationHelper
import java.io.File

class InstallApkModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    /** 让 JS 首次渲染时即可同步获得 APK 的真实版本，避免先显示 bundle 版本。 */
    override fun getConstants(): MutableMap<String, Any> {
        return mutableMapOf(
            "appVersion" to BuildConfig.VERSION_NAME,
            "versionCode" to BuildConfig.VERSION_CODE
        )
    }

    override fun getName(): String {
        return "InstallApk"
    }

    /**
     * 返回当前已安装 APK 的真实版本号。
     * 不从 JS bundle 读取 package.json，避免热更新包携带旧版本号时造成循环更新。
     */
    @ReactMethod
    fun getAppVersion(promise: Promise) {
        promise.resolve(BuildConfig.VERSION_NAME)
    }

    /** 发现新版本时发送一次系统通知；同一版本不会重复骚扰用户。 */
    @ReactMethod
    fun notifyUpdateAvailable(version: String, updateLog: String?, promise: Promise) {
        promise.resolve(UpdateNotificationHelper.notifyIfNeeded(reactApplicationContext, version, updateLog))
    }

    @ReactMethod
    fun install(filePath: String) {
        try {
            val file = File(filePath)
            if (!file.exists()) {
                android.util.Log.e("InstallApk", "APK 文件不存在: $filePath")
                return
            }

            val context = reactApplicationContext
            val intent = Intent(Intent.ACTION_VIEW)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

            // Android 7.0+ 需要使用 FileProvider
            val apkUri: Uri = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
                FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    file
                )
            } else {
                Uri.fromFile(file)
            }

            intent.setDataAndType(apkUri, "application/vnd.android.package-archive")
            context.startActivity(intent)

            android.util.Log.d("InstallApk", "启动 APK 安装: $filePath")
        } catch (e: Exception) {
            android.util.Log.e("InstallApk", "安装 APK 失败", e)
        }
    }
}
