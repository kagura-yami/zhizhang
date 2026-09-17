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
                    if (!downloaded) return Result.retry()
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

    private fun downloadApk(downloadUrl: String, version: String): Boolean = try {
        ApkDownloadCoordinator.download(applicationContext, downloadUrl, version)
        true
    } catch (error: Exception) {
        android.util.Log.w(TAG, "更新包下载中断，保留断点供下次继续", error)
        false
    }
}
