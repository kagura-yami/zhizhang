package com.zhizhang.utils

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
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

    /**
     * 校验缓存 APK 是否是完整且属于知账的目标版本。
     * 只检查文件存在会把中断下载的半包当成可安装包，必须交给系统解析 APK
     * 元数据后再允许进入安装器。
     */
    @ReactMethod
    fun validateApk(filePath: String, expectedVersion: String, promise: Promise) {
        try {
            val file = File(filePath)
            if (!file.exists() || file.length() < 1024L * 1024L) {
                promise.resolve(false)
                return
            }
            val packageInfo = reactApplicationContext.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
            val valid = packageInfo != null &&
                packageInfo.packageName == BuildConfig.APPLICATION_ID &&
                (expectedVersion.isBlank() || packageInfo.versionName == expectedVersion)
            promise.resolve(valid)
        } catch (error: Exception) {
            android.util.Log.w("InstallApk", "校验 APK 失败: $filePath", error)
            promise.resolve(false)
        }
    }

    /** 发现新版本时发送一次系统通知；同一版本不会重复骚扰用户。 */
    @ReactMethod
    fun notifyUpdateAvailable(version: String, updateLog: String?, packageReady: Boolean, promise: Promise) {
        promise.resolve(UpdateNotificationHelper.notifyIfNeeded(reactApplicationContext, version, updateLog, packageReady))
    }

    @ReactMethod
    fun install(filePath: String, promise: Promise) {
        try {
            val file = File(filePath)
            // 安装入口本身也必须做一次完整校验，不能只依赖 JS 层的检查。
            // 通知栏、旧页面或第三方调用可能直接触发这个方法；若此时文件仍是
            // .part 半包，系统安装器会报“解析包错误”，甚至留下损坏缓存。
            if (!isInstallableApk(file)) {
                android.util.Log.w("InstallApk", "拒绝安装无效或未完成的 APK: $filePath")
                promise.reject("INVALID_APK", "安装包已损坏或不完整，请重新下载更新。")
                return
            }

            val context = reactApplicationContext
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !context.packageManager.canRequestPackageInstalls()) {
                val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}"))
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(settings)
                promise.reject("INSTALL_PERMISSION_REQUIRED", "请允许知账安装应用，然后返回知账再次点击立即更新。")
                return
            }
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
            promise.resolve(true)

            android.util.Log.d("InstallApk", "启动 APK 安装: $filePath")
        } catch (e: Exception) {
            android.util.Log.e("InstallApk", "安装 APK 失败", e)
            promise.reject("INSTALL_START_FAILED", "无法打开系统安装器，请检查安装权限后重试。", e)
        }
    }

    private fun isInstallableApk(file: File): Boolean {
        if (!file.exists() || !file.isFile || file.name.endsWith(".part") ||
            file.length() < 1024L * 1024L) {
            return false
        }
        val packageInfo = reactApplicationContext.packageManager
            .getPackageArchiveInfo(file.absolutePath, 0)
        return packageInfo != null && packageInfo.packageName == BuildConfig.APPLICATION_ID
    }
}
