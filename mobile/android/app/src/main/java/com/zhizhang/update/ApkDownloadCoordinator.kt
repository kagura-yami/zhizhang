package com.zhizhang.update

import android.content.Context
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

/** 前台 JS 与 WorkManager 共用下载锁和缓存，避免多次下载占用带宽。 */
object ApkDownloadCoordinator {
    private val lock = Any()
    private data class Listener(val version: String, val callback: (Long, Long) -> Unit)
    private val listeners = CopyOnWriteArrayList<Listener>()
    private val downloader = ResumableApkDownloader(OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build())
    fun download(context: Context, url: String, version: String, progress: ((Long, Long) -> Unit)? = null): File {
        require(Regex("[0-9]+(?:\\.[0-9]+){1,3}").matches(version)) { "无效的更新版本" }
        val listener = progress?.let { Listener(version, it) }
        if (listener != null) listeners.add(listener)
        try {
            return synchronized(lock) {
                val target = File(context.cacheDir, "app-v$version.apk")
                downloader.download(url, target, { file ->
                    if (!file.isFile || file.length() < 1024L * 1024L) false
                    else context.packageManager.getPackageArchiveInfo(file.path, 0)?.let { it.packageName == context.packageName && it.versionName == version } ?: false
                }, { done, total -> listeners.filter { it.version == version }.forEach { try { it.callback(done, total) } catch (_: Exception) {} } })
            }
        } finally { if (listener != null) listeners.remove(listener) }
    }
}
