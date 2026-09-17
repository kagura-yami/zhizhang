package com.zhizhang.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.zhizhang.BuildConfig
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Private key stays in Android Keystore; only signatures and the public key leave it. */
object DeviceSession {
    private const val ALIAS = "zhizhang.device.session.v1"
    lateinit var context: Context
    @Volatile var onRejected: ((String) -> Unit)? = null
    private val base by lazy { BuildConfig.API_BASE_URL.trimEnd('/').toHttpUrl() }
    private val refreshClient by lazy { OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).followRedirects(false).build() }
    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    @Synchronized fun publicKey(): String {
        val ks = store()
        if (!ks.containsAlias(ALIAS)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
            }.generateKeyPair()
        }
        return Base64.encodeToString(store().getCertificate(ALIAS).publicKey.encoded, Base64.NO_WRAP)
    }
    private fun sign(value: String): String = try {
        val key = store().getKey(ALIAS, null) as? java.security.PrivateKey ?: throw Rejected()
        Base64.encodeToString(Signature.getInstance("SHA256withECDSA").run {
            initSign(key); update(value.toByteArray(Charsets.UTF_8)); sign()
        }, Base64.NO_WRAP)
    } catch (_: Exception) { throw Rejected() }
    fun payload(token: String): JSONObject? = try { JSONObject(String(Base64.decode(token.split('.')[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8)) } catch (_: Exception) { null }
    private class Rejected: IOException("登录状态已失效，请重新登录")
    private fun post(path: String, body: JSONObject): JSONObject {
        val request = Request.Builder().url(base.toString().trimEnd('/') + path)
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()
        refreshClient.newCall(request).execute().use { response ->
            if (response.code == 401 || response.code == 403) throw Rejected()
            if (!response.isSuccessful) throw IOException("登录续期暂时不可用，请稍后重试")
            return JSONObject(response.body?.string() ?: throw IOException("Empty response")).getJSONObject("data")
        }
    }
    @Synchronized private fun currentToken(requested: String): String {
        val wanted = payload(requested) ?: return requested
        val sid = wanted.optString("sid")
        if (sid.isEmpty()) return requested
        val current = AuthTokenModule.getToken(context) ?: throw Rejected()
        val claims = payload(current) ?: throw Rejected()
        if (claims.optString("sid") != sid) throw Rejected()
        if (claims.optLong("exp") * 1000 > System.currentTimeMillis() + 120000) return current
        val challenge = post("/auth/device/challenge", JSONObject().put("sessionId", sid)).getString("challenge")
        val renewed = post("/auth/device/renew", JSONObject().put("challenge", challenge).put("signature", sign(challenge))).getString("token")
        // Do not let an in-flight renewal restore a signed-out or switched account.
        if (payload(AuthTokenModule.getToken(context) ?: "")?.optString("sid") != sid) throw Rejected()
        AuthTokenModule.saveToken(context, renewed)
        return renewed
    }
    fun interceptor() = Interceptor { chain ->
        val request = chain.request()
        val original = request.header("Authorization")?.takeIf { it.startsWith("Bearer ") }?.removePrefix("Bearer ")
        // Never attach device proofs to AI providers or other origins.
        if (original == null || request.url.scheme != base.scheme || request.url.host != base.host || request.url.port != base.port || payload(original)?.optString("sid").isNullOrEmpty()) {
            chain.proceed(request)
        } else {
            val response = try {
                val token = currentToken(original)
                val time = System.currentTimeMillis().toString()
                val nonce = UUID.randomUUID().toString()
                val hash = MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).joinToString("") { "%02x".format(it) }
                val target = request.url.encodedPath + (request.url.encodedQuery?.let { "?" + it } ?: "")
                val proof = sign(listOf("v1", request.method, target, hash, time, nonce).joinToString("\n"))
                chain.proceed(request.newBuilder().header("Authorization", "Bearer $token")
                    .header("X-Device-Time", time).header("X-Device-Nonce", nonce).header("X-Device-Signature", proof).build())
            } catch (_: Rejected) {
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(401).message("Unauthorized")
                    .body(ResponseBody.create("application/json".toMediaType(), "{\"message\":\"登录状态已失效，请重新登录\"}")).build()
            }
            if (response.code == 401) onRejected?.invoke(original)
            response
        }
    }
}
