package com.zhizhang.update

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Test
import org.junit.Assert.*
import java.nio.file.Files
import java.io.File
import java.io.IOException
import java.util.Properties

class ResumableApkDownloaderTest {
    private fun fixture(test: (MockWebServer, File, ResumableApkDownloader) -> Unit) {
        val server = MockWebServer(); server.start()
        val dir = Files.createTempDirectory("apk-download-test").toFile()
        try { test(server, File(dir, "update.apk"), ResumableApkDownloader(OkHttpClient())) }
        finally { server.shutdown(); dir.deleteRecursively() }
    }
    private fun partial(target: File, url: String) {
        File(target.path + ".part").writeText("abc")
        Properties().apply { setProperty("url", url); setProperty("validator", "\"v1\"") }.also { p -> File(target.path + ".resume").outputStream().use { p.store(it, null) } }
    }
    private fun full() = MockResponse().setBody("abcdef").setHeader("ETag", "\"v1\"")
    private fun tail() = MockResponse().setResponseCode(206).setBody("def").setHeader("Content-Range", "bytes 3-5/6").setHeader("ETag", "\"v1\"")
    private val valid: (File) -> Boolean = { it.exists() && it.readText() == "abcdef" }
    @Test fun completeDownloadAndCachedReuse() = fixture { server, target, downloader ->
        server.enqueue(full()); val url = server.url("/apk").toString()
        downloader.download(url,target,valid) { _,_ -> }
        downloader.download(url,target,valid) { _,_ -> }
        assertEquals(1,server.requestCount); assertTrue(valid(target))
    }
    @Test fun resumesSavedPartialWithValidator() = fixture { server,target,downloader ->
        val url=server.url("/apk").toString(); partial(target,url); server.enqueue(tail())
        downloader.download(url,target,valid) { _,_ -> }
        val req=server.takeRequest(); assertEquals("bytes=3-",req.getHeader("Range")); assertEquals("\"v1\"",req.getHeader("If-Range")); assertTrue(valid(target))
    }
    @Test fun serverIgnoringRangeReplacesPartial() = fixture { server,target,downloader ->
        val url=server.url("/apk").toString(); partial(target,url); server.enqueue(full())
        downloader.download(url,target,valid) { _,_ -> }; assertTrue(valid(target))
    }
    @Test fun mismatchedRangeNeverAppends() = fixture { server,target,downloader ->
        val url=server.url("/apk").toString(); partial(target,url)
        server.enqueue(tail().setHeader("Content-Range","bytes 2-4/6")); server.enqueue(full())
        downloader.download(url,target,valid) { _,_ -> }; server.takeRequest(); assertNull(server.takeRequest().getHeader("Range")); assertTrue(valid(target))
    }
    @Test fun failedConnectionPreservesPartialForNextAttempt() = fixture { server,target,downloader ->
        val url=server.url("/apk").toString(); partial(target,url); repeat(3) { server.enqueue(MockResponse().setResponseCode(503)) }
        try { downloader.download(url,target,valid) { _,_ -> }; fail("must fail") } catch (_: IOException) {}
        assertEquals("abc",File(target.path+".part").readText()); assertFalse(target.exists())
        server.enqueue(tail()); downloader.download(url,target,valid) { _,_ -> }; assertTrue(valid(target))
    }
    @Test fun rejectedPackageNeverReachesFinalPath() = fixture { server,target,downloader ->
        repeat(3) { server.enqueue(MockResponse().setBody("broken")) }
        try { downloader.download(server.url("/apk").toString(),target,valid) { _,_ -> }; fail("must fail") } catch (_: IOException) {}
        assertFalse(target.exists()); assertFalse(File(target.path+".part").exists())
    }
    @Test fun concurrentCallersShareCompletedFile() = fixture { server,target,downloader ->
        server.enqueue(full().setBodyDelay(100,java.util.concurrent.TimeUnit.MILLISECONDS))
        val pool=java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val tasks=(1..2).map { pool.submit<File> { downloader.download(server.url("/apk").toString(),target,valid) { _,_ -> } } }
            tasks.forEach { assertEquals(target,it.get(5,java.util.concurrent.TimeUnit.SECONDS)) }
            assertEquals(1,server.requestCount)
        } finally { pool.shutdownNow() }
    }
    @Test fun realInterruptedBodyResumesRemainingBytes() = fixture { server,target,downloader ->
        val bytes="a".repeat(128*1024)
        var requests=0
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request:okhttp3.mockwebserver.RecordedRequest):MockResponse {
                if (requests++ == 0) return MockResponse().setBody(bytes).setHeader("ETag","v1").setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
                val offset=request.getHeader("Range")!!.removePrefix("bytes=").removeSuffix("-").toInt()
                return MockResponse().setResponseCode(206).setHeader("ETag","v1").setHeader("Content-Range","bytes $offset-${bytes.length-1}/${bytes.length}").setBody(bytes.substring(offset))
            }
        }
        downloader.download(server.url("/apk").toString(),target,{it.exists()&&it.readText()==bytes}) { _,_ -> }
        assertEquals(bytes,target.readText()); assertEquals(2,server.requestCount)
    }

}
