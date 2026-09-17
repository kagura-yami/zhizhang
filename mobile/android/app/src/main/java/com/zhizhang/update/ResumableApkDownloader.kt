package com.zhizhang.update

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Properties

/** 单个安装包的可恢复下载；调用者负责串行化同一目标文件。 */
class ResumableApkDownloader(private val client: OkHttpClient) {
    @Synchronized
    fun download(url: String, target: File, validate: (File) -> Boolean, progress: (Long, Long) -> Unit): File {
        if (validate(target)) { progress(target.length(), target.length()); return target }
        val partial = File(target.path + ".part")
        val meta = File(target.path + ".resume")
        var lastError: IOException? = null
        repeat(3) {
            try {
                val saved = Properties()
                if (meta.exists()) try { meta.inputStream().use { saved.load(it) } } catch (_: Exception) { saved.clear() }
                var offset = if (saved.getProperty("url") == url && !saved.getProperty("validator").isNullOrBlank()) partial.length() else 0L
                val request = Request.Builder().url(url).header("Accept-Encoding", "identity")
                if (offset > 0) request.header("Range", "bytes=$offset-").header("If-Range", saved.getProperty("validator"))
                client.newCall(request.build()).execute().use { response ->
                    if (response.code == 416) {
                        partial.delete(); meta.delete(); throw IOException("下载范围已变化，正在重新下载")
                    }
                    if (response.code != 200 && response.code != 206) throw IOException("下载失败：HTTP ${response.code}")
                    val body = response.body ?: throw IOException("更新包内容为空")
                    val validator = response.header("ETag")?.takeUnless { it.startsWith("W/") } ?: response.header("Last-Modified").orEmpty()
                    val total: Long
                    if (response.code == 206) {
                        val range = Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(response.header("Content-Range").orEmpty())
                        val start = range?.groupValues?.get(1)?.toLongOrNull()
                        val end = range?.groupValues?.get(2)?.toLongOrNull()
                        total = range?.groupValues?.get(3)?.toLongOrNull() ?: -1L
                        if (start != offset || end == null || end < offset || total <= end || offset == 0L || validator != saved.getProperty("validator")) {
                            partial.delete(); meta.delete(); throw IOException("续传响应不匹配，正在重新下载")
                        }
                    } else { offset = 0; total = body.contentLength() }
                    if (offset == 0L) FileOutputStream(partial).use { } // 先截断，避免旧文件匹配新元信息
                    Properties().apply { setProperty("url", url); setProperty("validator", validator) }.also { p -> meta.outputStream().use { p.store(it, null) } }
                    var written = offset
                    var lastPercent = -1
                    FileOutputStream(partial, offset > 0).use { output ->
                        body.byteStream().use { input ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count); written += count
                                val percent = if (total > 0) (written * 100 / total).toInt() else 0
                                if (percent != lastPercent) { progress(written, total); lastPercent = percent }
                            }
                        }
                    }
                    if (total > 0 && written != total) throw IOException("下载尚未完整，将继续下载")
                    if (!validate(partial)) { partial.delete(); meta.delete(); throw IOException("安装包校验失败，请重新下载") }
                    if (!partial.renameTo(target)) throw IOException("安装包保存失败")
                    meta.delete(); progress(target.length(), target.length()); return target
                }
            } catch (error: IOException) { lastError = error }
        }
        // 保留可续传文件；下一次检查、网络恢复或重新打开应用可继续。
        throw lastError ?: IOException("下载失败，请稍后重试")
    }
}
