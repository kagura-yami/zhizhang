package com.zhizhang.update

import android.content.Context
import android.net.Uri
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.zhizhang.BuildConfig
import com.zhizhang.utils.UpdateNotificationHelper
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

/**
 * 在应用不处于前台时检查 Android APK 更新。
 *
 * 版本接口是公开接口，不需要用户登录令牌；更新通知本身由原生层发送，
 * 因此不会依赖 React Native 引擎或当前页面是否存活。
 */
class UpdateCheckWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : Worker(appContext, workerParams) {

    companion object {
        private const val TAG = "UpdateCheckWorker"
        private val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    override fun doWork(): Result {
        val endpoint = buildEndpoint() ?: return Result.success()
        return try {
            val request = Request.Builder().url(endpoint).get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    android.util.Log.w(TAG, "检查更新失败: HTTP ${response.code}")
                    return if (response.code >= 500) Result.retry() else Result.success()
                }

                val body = response.body?.string().orEmpty()
                val data = JSONObject(body).optJSONObject("data") ?: return Result.success()
                if (!data.optBoolean("hasUpdate", false)) return Result.success()

                val latest = data.optJSONObject("latestVersion") ?: return Result.success()
                val version = latest.optString("version").trim()
                val downloadUrl = latest.optString("downloadUrl").trim()
                if (version.isNotEmpty() && downloadUrl.isNotEmpty()) {
                    val downloaded = downloadApk(downloadUrl, version)
                    UpdateNotificationHelper.notifyIfNeeded(
                        applicationContext,
                        version,
                        latest.optString("updateLog"),
                        downloaded
                    )
                }
                Result.success()
            }
        } catch (error: Exception) {
            android.util.Log.w(TAG, "后台检查更新失败", error)
            Result.retry()
        }
    }

    private fun buildEndpoint(): String? {
        val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')
        if (baseUrl.isBlank()) return null
        return "$baseUrl/app-version/check?currentVersion=${Uri.encode(BuildConfig.VERSION_NAME)}&platform=android&_ts=${System.currentTimeMillis()}"
    }

    /**
     * 在 WorkManager 后台任务中预下载 APK，不启动安装器。
     * RNFS.CachesDirectoryPath 与 Android cacheDir 对应，前台进入应用后可直接复用该文件。
     */
    private fun downloadApk(downloadUrl: String, version: String): Boolean {
        val cacheDir = applicationContext.cacheDir
        val target = File(cacheDir, "app-v$version.apk")
        if (isValidApk(target, version)) return true
        if (target.exists()) target.delete()

        // 前台 RN 下载与 WorkManager 可能同时运行，使用唯一临时文件避免互相
        // 删除或覆盖；只有校验通过后才原子替换正式 APK。
        val partial = File(
            cacheDir,
            "app-v$version.apk.part-${System.currentTimeMillis()}-${Thread.currentThread().id}"
        )
        cleanupStalePartials(cacheDir, version)
        return try {
            val request = Request.Builder().url(downloadUrl).get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    android.util.Log.w(TAG, "后台下载更新包失败: HTTP ${response.code}")
                    return false
                }
                val body = response.body ?: return false
                FileOutputStream(partial).use { output ->
                    body.byteStream().use { input -> input.copyTo(output) }
                }
                if (!partial.exists() || partial.length() <= 0L || !isValidApk(partial, version)) {
                    partial.delete()
                    return false
                }
                // 同目录 rename 是原子操作；不再 fallback 到直接 copy target，避免
                // 安装器在 copy 尚未完成时看到半包文件。
                if (target.exists()) target.delete()
                if (!partial.renameTo(target)) {
                    android.util.Log.w(TAG, "更新包原子替换失败: ${target.name}")
                    partial.delete()
                    return false
                }
                android.util.Log.i(TAG, "更新包已后台下载: ${target.name}, ${target.length()} bytes")
                isValidApk(target, version)
            }
        } catch (error: Exception) {
            android.util.Log.w(TAG, "后台下载更新包异常", error)
            partial.delete()
            false
        }
    }

    private fun cleanupStalePartials(cacheDir: File, version: String) {
        val prefix = "app-v$version.apk.part-"
        val expiry = System.currentTimeMillis() - TimeUnit.HOURS.toMillis(24)
        cacheDir.listFiles()
            ?.filter { it.name.startsWith(prefix) && it.lastModified() < expiry }
            ?.forEach { it.delete() }
    }

    private fun isValidApk(file: File, expectedVersion: String): Boolean {
        if (!file.exists() || file.length() < 1024L * 1024L) return false
        val info = applicationContext.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
        return info != null && info.packageName == applicationContext.packageName &&
            (expectedVersion.isBlank() || info.versionName == expectedVersion)
    }
}
