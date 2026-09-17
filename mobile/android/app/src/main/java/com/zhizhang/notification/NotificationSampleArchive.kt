package com.zhizhang.notification

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Base64
import android.util.Log
import com.google.gson.Gson
import com.zhizhang.BuildConfig
import com.zhizhang.auth.AuthTokenModule
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** 原文先落在应用私有 SQLite，再按所属用户幂等上传；成功后只保留本地指纹。 */
object NotificationSampleArchive {
    private val executor = Executors.newSingleThreadExecutor()
    private val gson = Gson()
    private val client = OkHttpClient.Builder().addInterceptor(com.zhizhang.auth.DeviceSession.interceptor()).connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()
    private var database: SQLiteDatabase? = null
    private var lastAttempt = 0L

    private fun db(context: Context): SQLiteDatabase {
        return database ?: object : SQLiteOpenHelper(context.applicationContext, "notification_samples.db", null, 1) {
            override fun onCreate(db: SQLiteDatabase) {
                db.execSQL("CREATE TABLE samples (id TEXT NOT NULL, user_id TEXT NOT NULL, payload TEXT, captured_at INTEGER NOT NULL, PRIMARY KEY(user_id,id))")
            }
            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
        }.writableDatabase.also { database = it }
    }

    private fun owner(token: String?): String? = runCatching {
        val part = token?.split('.')?.getOrNull(1) ?: return null
        JSONObject(String(Base64.decode(part, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8))
            .optString("sub").takeIf { it.isNotBlank() }
    }.getOrNull()

    private fun iso(time: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(java.util.Date(time))

    fun capture(context: Context, content: PaymentNotificationContent, match: PaymentMatch?,
                notificationKey: String, postedAt: Long, status: String, reason: String) {
        if (!PaymentNotificationParser.shouldArchive(content)) return
        val appContext = context.applicationContext
        // 在捕获时绑定账号，异步任务执行或切换账号后不重新归属。
        val userId = owner(AuthTokenModule.getToken(appContext)) ?: return
        val capturedAt = System.currentTimeMillis()
        executor.execute {
            runCatching {
                val raw = JSONObject(gson.toJson(content)).put("notificationKey", notificationKey)
                val fingerprint = "$userId|$notificationKey|$postedAt|${raw}|${PaymentNotificationParser.RULE_VERSION}"
                val id = MessageDigest.getInstance("SHA-256").digest(fingerprint.toByteArray(Charsets.UTF_8))
                    .joinToString("") { "%02x".format(it) }
                val payload = JSONObject().put("sampleId", id).put("packageName", content.packageName)
                    .put("appVersion", BuildConfig.VERSION_NAME).put("ruleVersion", PaymentNotificationParser.RULE_VERSION)
                    .put("postedAt", iso(postedAt.takeIf { it > 0 } ?: capturedAt)).put("capturedAt", iso(capturedAt))
                    .put("status", status).put("reason", reason).put("raw", raw)
                if (match != null) payload.put("parsed", JSONObject(gson.toJson(match)))
                db(appContext).insertWithOnConflict("samples", null, ContentValues().apply {
                    put("id", id); put("user_id", userId); put("payload", payload.toString()); put("captured_at", capturedAt)
                }, SQLiteDatabase.CONFLICT_IGNORE)
                upload(appContext)
            }.onFailure { Log.w("NotificationArchive", "通知样本留档失败: ${it.javaClass.simpleName}") }
        }
    }

    fun flush(context: Context) {
        val appContext = context.applicationContext
        executor.execute { runCatching { upload(appContext) }.onFailure { Log.w("NotificationArchive", "样本上传暂缓: ${it.javaClass.simpleName}") } }
    }

    private fun upload(context: Context) {
        val now = System.currentTimeMillis()
        if (now - lastAttempt < 30_000L) return
        val token = AuthTokenModule.getToken(context) ?: return
        val userId = owner(token) ?: return
        val pending = JSONArray()
        db(context).rawQuery("SELECT payload FROM samples WHERE user_id=? AND payload IS NOT NULL ORDER BY captured_at LIMIT 25", arrayOf(userId)).use { cursor ->
            while (cursor.moveToNext()) pending.put(JSONObject(cursor.getString(0)))
        }
        if (pending.length() == 0) return
        lastAttempt = now
        val request = Request.Builder().url("${BuildConfig.API_BASE_URL.trimEnd('/')}/notification-samples/batch")
            .header("Authorization", "Bearer $token")
            .post(JSONObject().put("samples", pending).toString().toRequestBody("application/json; charset=utf-8".toMediaType())).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return
            val result = JSONObject(response.body?.string() ?: return)
            if (!result.optBoolean("success")) return
            val accepted = result.optJSONObject("data")?.optJSONArray("acceptedIds") ?: return
            db(context).beginTransaction()
            try {
                val sentIds = (0 until pending.length()).map { pending.getJSONObject(it).getString("sampleId") }.toSet()
                for (i in 0 until accepted.length()) {
                    val id = accepted.getString(i)
                    if (id in sentIds) db(context).execSQL("UPDATE samples SET payload=NULL WHERE user_id=? AND id=?", arrayOf(userId, id))
                }
                db(context).execSQL("DELETE FROM samples WHERE payload IS NULL AND captured_at<?", arrayOf(now - 30L * 24 * 60 * 60 * 1000))
                db(context).setTransactionSuccessful()
            } finally { db(context).endTransaction() }
        }
    }
}
