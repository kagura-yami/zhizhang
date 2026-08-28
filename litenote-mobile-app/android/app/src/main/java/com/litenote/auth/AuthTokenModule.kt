package com.litenote.auth

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

/**
 * Auth Token Native Module
 * 用于在 React Native 和 Android 原生层之间共享认证 Token
 */
class AuthTokenModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "AuthTokenModule"
        private const val PREFS_NAME = "AuthTokenSecurePrefs"
        private const val LEGACY_PREFS_NAME = "AuthTokenPrefs"
        private const val KEY_AUTH_TOKEN = "auth_token"

        /**
         * 静态方法：供 Android 原生代码获取 Token
         */
        fun getToken(context: Context): String? {
            val prefs = getSecurePrefs(context)
            val secureToken = prefs.getString(KEY_AUTH_TOKEN, null)
            if (!secureToken.isNullOrBlank()) return secureToken

            // 迁移旧版明文 SharedPreferences，读取后立即转入 Keystore 并删除旧副本。
            val legacyPrefs = context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
            val legacyToken = legacyPrefs.getString(KEY_AUTH_TOKEN, null)
            if (!legacyToken.isNullOrBlank()) {
                prefs.edit().putString(KEY_AUTH_TOKEN, legacyToken).apply()
                legacyPrefs.edit().remove(KEY_AUTH_TOKEN).apply()
            }
            return legacyToken
        }

        private fun getSecurePrefs(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }

    override fun getName(): String = "AuthTokenModule"

    private fun getPrefs(): SharedPreferences {
        return getSecurePrefs(reactApplicationContext)
    }

    /**
     * 保存 Token（从 RN 调用）
     */
    @ReactMethod
    fun setToken(token: String, promise: Promise) {
        try {
            Log.d(TAG, "保存 Token 到 Android Keystore 加密存储")
            getPrefs().edit().putString(KEY_AUTH_TOKEN, token).apply()
            reactApplicationContext.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
                .edit().remove(KEY_AUTH_TOKEN).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "保存 Token 失败: ${e.message}", e)
            promise.reject("SET_TOKEN_ERROR", e.message, e)
        }
    }

    /**
     * 获取 Token（从 RN 调用）
     */
    @ReactMethod
    fun getToken(promise: Promise) {
        try {
            val token = getToken(reactApplicationContext)
            promise.resolve(token)
        } catch (e: Exception) {
            Log.e(TAG, "获取 Token 失败: ${e.message}", e)
            promise.reject("GET_TOKEN_ERROR", e.message, e)
        }
    }

    /**
     * 清除 Token（登出时调用）
     */
    @ReactMethod
    fun clearToken(promise: Promise) {
        try {
            Log.d(TAG, "清除 Token")
            getPrefs().edit().remove(KEY_AUTH_TOKEN).apply()
            reactApplicationContext.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
                .edit().remove(KEY_AUTH_TOKEN).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "清除 Token 失败: ${e.message}", e)
            promise.reject("CLEAR_TOKEN_ERROR", e.message, e)
        }
    }
}
