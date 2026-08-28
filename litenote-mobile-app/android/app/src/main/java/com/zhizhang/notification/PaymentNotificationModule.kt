package com.zhizhang.notification

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.Manifest
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.media.MediaExtractor
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.media.MediaPlayer
import android.media.MediaFormat
import android.provider.Settings
import androidx.core.content.FileProvider
import android.util.Log
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID

/**
 * 支付通知监听 React Native 模块
 * 
 * 提供给 JavaScript 层的接口，用于：
 * 1. 检查通知监听权限状态
 * 2. 请求通知监听权限
 * 3. 接收支付通知事件
 * 
 * 使用方式（JavaScript）：
 * ```javascript
 * import { NativeModules, NativeEventEmitter } from 'react-native';
 * 
 * const { PaymentNotificationModule } = NativeModules;
 * const eventEmitter = new NativeEventEmitter(PaymentNotificationModule);
 * 
 * // 检查权限
 * const status = await PaymentNotificationModule.getPermissionStatus();
 * 
 * // 请求权限
 * PaymentNotificationModule.requestPermission();
 * 
 * // 监听支付事件
 * eventEmitter.addListener('onPaymentDetected', (event) => {
 *   console.log('Payment detected:', event);
 * });
 * ```
 * 
 * @author zhizhang
 * @since 1.0.0
 */
class PaymentNotificationModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "PaymentNotificationModule"

        /** 模块名称，JavaScript 中通过此名称访问 */
        const val MODULE_NAME = "PaymentNotificationModule"

        /** 事件名称：账单创建成功 */
        const val EVENT_BILL_CREATED = "onBillCreated"

        /** 权限状态：已授权 */
        const val PERMISSION_AUTHORIZED = "authorized"
        
        /** 权限状态：未授权 */
        const val PERMISSION_DENIED = "denied"
        
        /** 权限状态：未知 */
        const val PERMISSION_UNKNOWN = "unknown"
        private const val BILL_NOTIFICATION_PREFS = "bill_notification_settings"
        private const val KEY_NOTIFICATION_ENABLED = "enabled"
        private const val KEY_NOTIFICATION_SOUND = "sound"
        private const val KEY_NOTIFICATION_SOUND_URI = "sound_uri"
        private const val KEY_NOTIFICATION_SOUND_NAME = "sound_name"
        private const val KEY_SOUND_LIBRARY = "sound_library"
        private const val PICK_NOTIFICATION_SOUND_REQUEST = 4102
        private const val MAX_CLIP_MS = 30_000L
        private const val MIN_CLIP_MS = 500L
    }

    /** 支付通知广播接收器 */
    private var paymentReceiver: BroadcastReceiver? = null
    
    /** 是否已注册广播接收器 */
    private var isReceiverRegistered = false
    private var soundPickerPromise: Promise? = null
    private var previewPlayer: MediaPlayer? = null
    private var previewStopRunnable: Runnable? = null

    init {
        reactContext.addLifecycleEventListener(this)
        reactContext.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != PICK_NOTIFICATION_SOUND_REQUEST) return
                val promise = soundPickerPromise
                soundPickerPromise = null
                if (promise == null) return
                if (resultCode != Activity.RESULT_OK || data?.data == null) {
                    promise.resolve(null)
                    return
                }
                val uri = data.data!!
                runCatching {
                    val takeFlags = data.flags and
                        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    if (takeFlags != 0) {
                        reactContext.contentResolver.takePersistableUriPermission(uri, takeFlags)
                    }
                }
                val name = resolveDisplayName(uri)
                val durationMs = resolveDurationMs(uri)
                if (durationMs <= 0L) {
                    promise.reject("INVALID_AUDIO", "无法读取音频时长")
                    return
                }
                val item = SoundLibraryItem(
                    id = UUID.randomUUID().toString(),
                    name = name,
                    sourceUri = uri.toString(),
                    soundUri = uri.toString(),
                    startMs = 0L,
                    endMs = durationMs,
                    durationMs = durationMs,
                    createdAt = System.currentTimeMillis()
                )
                val library = loadSoundLibrary().filterNot { it.sourceUri == item.sourceUri }.toMutableList()
                library.add(item)
                saveSoundLibrary(library.takeLast(50))
                selectSound(item)
                promise.resolve(item.toWritableMap())
            }
        })
    }

    override fun getName(): String = MODULE_NAME

    /**
     * 获取通知监听权限状态
     * 
     * @param promise Promise 对象，返回权限状态字符串
     */
    @ReactMethod
    fun getPermissionStatus(promise: Promise) {
        try {
            val status = checkNotificationListenerPermission()
            promise.resolve(status)
        } catch (e: Exception) {
            Log.e(TAG, "检查权限状态失败", e)
            promise.reject("ERROR", "检查权限状态失败", e)
        }
    }

    /**
     * 请求通知监听权限
     * 
     * 打开系统设置页面，让用户手动授权通知访问权限
     */
    @ReactMethod
    fun requestPermission() {
        try {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            Log.i(TAG, "已打开通知监听权限设置页面")
        } catch (e: Exception) {
            Log.e(TAG, "打开通知监听权限设置页面失败", e)
        }
    }

    /**
     * 检查服务是否正在运行
     * 
     * @param promise Promise 对象，返回布尔值
     */
    @ReactMethod
    fun isServiceRunning(promise: Promise) {
        try {
            val isRunning = checkNotificationListenerPermission() == PERMISSION_AUTHORIZED
            promise.resolve(isRunning)
        } catch (e: Exception) {
            Log.e(TAG, "检查服务状态失败", e)
            promise.reject("ERROR", "检查服务状态失败", e)
        }
    }

    /**
     * 检查悬浮窗权限状态
     * 
     * @param promise Promise 对象，返回权限状态字符串
     */
    @ReactMethod
    fun getOverlayPermissionStatus(promise: Promise) {
        try {
            val hasPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.canDrawOverlays(reactContext)
            } else {
                true
            }
            promise.resolve(if (hasPermission) PERMISSION_AUTHORIZED else PERMISSION_DENIED)
        } catch (e: Exception) {
            Log.e(TAG, "检查悬浮窗权限失败", e)
            promise.reject("ERROR", "检查悬浮窗权限失败", e)
        }
    }

    /**
     * 请求悬浮窗权限
     * 
     * 打开系统设置页面，让用户手动授权悬浮窗权限
     */
    @ReactMethod
    fun requestOverlayPermission() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:${reactContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                Log.i(TAG, "已打开悬浮窗权限设置页面")
            }
        } catch (e: Exception) {
            Log.e(TAG, "打开悬浮窗权限设置页面失败", e)
        }
    }

    /** 获取自动记账成功通知设置。 */
    @ReactMethod
    fun getBillNotificationSettings(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(BILL_NOTIFICATION_PREFS, Context.MODE_PRIVATE)
            val result: WritableMap = Arguments.createMap().apply {
                putBoolean("enabled", prefs.getBoolean(KEY_NOTIFICATION_ENABLED, true))
                putString("sound", prefs.getString(KEY_NOTIFICATION_SOUND, "default") ?: "default")
                putString("soundUri", prefs.getString(KEY_NOTIFICATION_SOUND_URI, null))
                putString("soundName", prefs.getString(KEY_NOTIFICATION_SOUND_NAME, null))
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERROR", "读取记账通知设置失败", e)
        }
    }

    /** 保存自动记账成功通知设置。 */
    @ReactMethod
    fun saveBillNotificationSettings(
        enabled: Boolean,
        sound: String,
        soundUri: String?,
        soundName: String?,
        promise: Promise
    ) {
        try {
            val normalizedSound = when (sound) {
                "silent" -> "silent"
                "custom" -> if (!soundUri.isNullOrBlank()) "custom" else "default"
                else -> "default"
            }
            reactContext.getSharedPreferences(BILL_NOTIFICATION_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_NOTIFICATION_ENABLED, enabled)
                .putString(KEY_NOTIFICATION_SOUND, normalizedSound)
                .apply {
                    if (!soundUri.isNullOrBlank()) putString(KEY_NOTIFICATION_SOUND_URI, soundUri)
                    if (!soundName.isNullOrBlank()) putString(KEY_NOTIFICATION_SOUND_NAME, soundName)
                }
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "保存记账通知设置失败", e)
        }
    }

    /** 获取用户曾导入过的铃声列表。 */
    @ReactMethod
    fun getBillNotificationSounds(promise: Promise) {
        try {
            val result = Arguments.createArray()
            loadSoundLibrary().forEach { result.pushMap(it.toWritableMap()) }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERROR", "读取铃声列表失败", e)
        }
    }

    /** 保存铃声片段，并生成实际用于通知声道的裁剪文件。 */
    @ReactMethod
    fun saveBillNotificationSoundClip(soundId: String, startMs: Double, endMs: Double, promise: Promise) {
        try {
            val item = loadSoundLibrary().firstOrNull { it.id == soundId }
                ?: throw IllegalArgumentException("铃声不存在")
            val start = startMs.toLong().coerceAtLeast(0L)
            val end = endMs.toLong().coerceAtMost(item.durationMs)
            if (end - start < MIN_CLIP_MS) throw IllegalArgumentException("铃声片段至少需要 ${MIN_CLIP_MS / 1000} 秒")
            if (end - start > MAX_CLIP_MS) throw IllegalArgumentException("通知铃声片段不能超过 ${MAX_CLIP_MS / 1000} 秒")
            val clippedUri = trimAudio(item.sourceUri, item.id, start, end)
            val updated = item.copy(soundUri = clippedUri, startMs = start, endMs = end)
            saveSoundLibrary(loadSoundLibrary().map { if (it.id == updated.id) updated else it })
            selectSound(updated)
            promise.resolve(updated.toWritableMap())
        } catch (e: Exception) {
            promise.reject("CLIP_ERROR", e.message ?: "裁剪铃声失败", e)
        }
    }

    /** 播放默认通知声或铃声库中的片段。 */
    @ReactMethod
    fun previewBillNotificationSound(soundId: String, promise: Promise) {
        try {
            stopPreviewInternal()
            val item = if (soundId == "default") null else loadSoundLibrary().firstOrNull { it.id == soundId }
            val uri = item?.soundUri?.let(Uri::parse)
                ?: if (soundId == "default") android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION) else null
            if (uri == null) throw IllegalArgumentException("铃声不存在")
            val startMs = item?.startMs ?: 0L
            val endMs = item?.endMs ?: 0L
            val player = MediaPlayer()
            previewPlayer = player
            player.setDataSource(reactContext, uri)
            player.setOnPreparedListener { prepared ->
                prepared.seekTo(startMs.toInt())
                prepared.start()
                if (endMs > startMs) {
                    val stop = Runnable { stopPreviewInternal() }
                    previewStopRunnable = stop
                    Handler(Looper.getMainLooper()).postDelayed(stop, endMs - startMs)
                }
            }
            player.setOnCompletionListener { stopPreviewInternal() }
            player.prepareAsync()
            promise.resolve(true)
        } catch (e: Exception) {
            stopPreviewInternal()
            promise.reject("PREVIEW_ERROR", e.message ?: "播放铃声失败", e)
        }
    }

    @ReactMethod
    fun stopBillNotificationSoundPreview() {
        stopPreviewInternal()
    }

    /** 从系统文件选择器选择自定义通知音频。 */
    @ReactMethod
    fun pickBillNotificationSound(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "当前无法打开文件选择器")
            return
        }
        if (soundPickerPromise != null) {
            promise.reject("PICKER_BUSY", "音频选择器正在使用")
            return
        }
        soundPickerPromise = promise
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "audio/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            activity.startActivityForResult(intent, PICK_NOTIFICATION_SOUND_REQUEST)
        } catch (e: Exception) {
            soundPickerPromise = null
            promise.reject("PICKER_ERROR", "打开音频选择器失败", e)
        }
    }

    private fun resolveDisplayName(uri: Uri): String {
        var cursor: Cursor? = null
        return try {
            cursor = reactContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            if (cursor?.moveToFirst() == true) {
                cursor?.getString(0)?.takeIf { it.isNotBlank() } ?: "自定义铃声"
            } else {
                uri.lastPathSegment?.substringAfterLast('/')?.ifBlank { "自定义铃声" } ?: "自定义铃声"
            }
        } catch (_: Exception) {
            "自定义铃声"
        } finally {
            cursor?.close()
        }
    }

    private fun resolveDurationMs(uri: Uri): Long {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(reactContext, uri)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        } finally {
            retriever.release()
        }
    }

    private fun trimAudio(sourceUri: String, id: String, startMs: Long, endMs: Long): String {
        val extractor = MediaExtractor()
        val soundDirectory = File(reactContext.filesDir, "notification_sounds").apply { mkdirs() }
        val outputFile = File(soundDirectory, "zhizhang-sound-$id-$startMs-$endMs.m4a")
        if (outputFile.exists()) outputFile.delete()
        return try {
            extractor.setDataSource(reactContext, Uri.parse(sourceUri), null)
            var audioTrack = -1
            for (index in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(index)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
                if (mime.startsWith("audio/")) {
                    audioTrack = index
                    break
                }
            }
            if (audioTrack < 0) throw IllegalArgumentException("未找到可用音频轨道")
            extractor.selectTrack(audioTrack)
            val format = extractor.getTrackFormat(audioTrack)
            val muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val outputTrack = muxer.addTrack(format)
            muxer.start()
            extractor.seekTo(startMs * 1000L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            val buffer = ByteBuffer.allocate(4 * 1024 * 1024)
            val info = android.media.MediaCodec.BufferInfo()
            while (true) {
                val sampleTime = extractor.sampleTime
                if (sampleTime < 0L || sampleTime > endMs * 1000L) break
                val sampleSize = extractor.readSampleData(buffer, 0)
                if (sampleSize <= 0) break
                info.offset = 0
                info.size = sampleSize
                info.presentationTimeUs = (sampleTime - startMs * 1000L).coerceAtLeast(0L)
                info.flags = extractor.sampleFlags
                muxer.writeSampleData(outputTrack, buffer, info)
                extractor.advance()
                buffer.clear()
            }
            muxer.stop()
            muxer.release()
            FileProvider.getUriForFile(reactContext, "${reactContext.packageName}.fileprovider", outputFile).toString()
        } finally {
            extractor.release()
        }
    }

    private fun selectSound(item: SoundLibraryItem) {
        reactContext.getSharedPreferences(BILL_NOTIFICATION_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_NOTIFICATION_SOUND, "custom")
            .putString(KEY_NOTIFICATION_SOUND_URI, item.soundUri)
            .putString(KEY_NOTIFICATION_SOUND_NAME, item.name)
            .apply()
    }

    private fun loadSoundLibrary(): List<SoundLibraryItem> {
        val json = reactContext.getSharedPreferences(BILL_NOTIFICATION_PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SOUND_LIBRARY, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(json)
            (0 until array.length()).mapNotNull { index -> SoundLibraryItem.fromJson(array.optJSONObject(index)) }
        }.getOrDefault(emptyList())
    }

    private fun saveSoundLibrary(items: List<SoundLibraryItem>) {
        val array = JSONArray()
        items.forEach { array.put(it.toJson()) }
        reactContext.getSharedPreferences(BILL_NOTIFICATION_PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_SOUND_LIBRARY, array.toString()).apply()
    }

    private fun stopPreviewInternal() {
        previewStopRunnable?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        previewStopRunnable = null
        previewPlayer?.runCatching { stop() }
        previewPlayer?.release()
        previewPlayer = null
    }

    /** 获取应用通知权限（Android 13+）。 */
    @ReactMethod
    fun getAppNotificationPermissionStatus(promise: Promise) {
        try {
            val authorized = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            } else {
                androidx.core.app.NotificationManagerCompat.from(reactContext).areNotificationsEnabled()
            }
            promise.resolve(if (authorized) PERMISSION_AUTHORIZED else PERMISSION_DENIED)
        } catch (e: Exception) {
            promise.reject("ERROR", "检查应用通知权限失败", e)
        }
    }

    /** 请求 Android 13+ 通知权限；无法直接请求时打开应用通知设置。 */
    @ReactMethod
    fun requestAppNotificationPermission() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val activity = reactContext.currentActivity
                if (activity != null) {
                    activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
                    return
                }
            }
            openAppNotificationSettings()
        } catch (e: Exception) {
            Log.e(TAG, "请求应用通知权限失败", e)
            openAppNotificationSettings()
        }
    }

    @ReactMethod
    fun openAppNotificationSettings() {
        try {
            val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "打开应用通知设置失败", e)
        }
    }

    /**
     * 获取设备厂商名称
     * 
     * @param promise Promise 对象，返回厂商名称字符串
     */
    @ReactMethod
    fun getDeviceManufacturer(promise: Promise) {
        try {
            promise.resolve(Build.MANUFACTURER)
        } catch (e: Exception) {
            Log.e(TAG, "获取设备厂商失败", e)
            promise.reject("ERROR", "获取设备厂商失败", e)
        }
    }

    /**
     * 启动监听
     * 
     * 注册广播接收器，开始接收支付通知事件
     */
    @ReactMethod
    fun startListening() {
        registerPaymentReceiver()
        Log.i(TAG, "已开始监听支付通知")
    }

    /**
     * 停止监听
     *
     * 注销广播接收器，停止接收支付通知事件
     */
    @ReactMethod
    fun stopListening() {
        unregisterPaymentReceiver()
        Log.i(TAG, "已停止监听支付通知")
    }

    /**
     * 保存监听应用配置
     *
     * @param monitoredApps 监听应用列表
     * @param filterKeywords 过滤关键词列表
     * @param promise Promise 对象
     */
    @ReactMethod
    fun saveMonitoringConfig(monitoredApps: ReadableArray, filterKeywords: ReadableArray, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences("payment_notification_config", Context.MODE_PRIVATE)
            val editor = prefs.edit()

            // 保存监听应用列表
            val appsJson = JSONArray()
            for (i in 0 until monitoredApps.size()) {
                val app = monitoredApps.getMap(i)
                val appJson = JSONObject().apply {
                    put("packageName", app?.getString("packageName") ?: "")
                    put("appName", app?.getString("appName") ?: "")
                    put("enabled", app?.getBoolean("enabled") ?: true)
                }
                appsJson.put(appJson)
            }
            editor.putString("monitored_apps", appsJson.toString())

            // 保存过滤关键词列表
            val keywordsJson = JSONArray()
            for (i in 0 until filterKeywords.size()) {
                keywordsJson.put(filterKeywords.getString(i))
            }
            editor.putString("filter_keywords", keywordsJson.toString())

            editor.apply()
            promise.resolve(true)
            Log.i(TAG, "配置已保存: ${appsJson.length()} 个应用, ${keywordsJson.length()} 个关键词")
        } catch (e: Exception) {
            Log.e(TAG, "保存配置失败", e)
            promise.reject("ERROR", "保存配置失败", e)
        }
    }

    /**
     * 获取已安装应用列表
     *
     * @param promise Promise 对象，返回应用列表
     */
    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val packagesByName = linkedMapOf<String, ApplicationInfo>()

            pm.getInstalledApplications(PackageManager.GET_META_DATA).forEach {
                packagesByName[it.packageName] = it
            }

            val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
            }
            pm.queryIntentActivities(launcherIntent, PackageManager.MATCH_ALL).forEach { resolved ->
                resolved.activityInfo?.applicationInfo?.let {
                    packagesByName[it.packageName] = it
                }
            }

            val presetPackages = PaymentNotificationParser.KNOWN_SUPPORTED_PACKAGES
            presetPackages.forEach { packageName ->
                try {
                    @Suppress("DEPRECATION")
                    val appInfo = pm.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
                    packagesByName[packageName] = appInfo
                } catch (_: PackageManager.NameNotFoundException) {
                    // 未安装的预设应用不展示。
                }
            }

            val appList: WritableArray = Arguments.createArray()

            packagesByName.values
                .sortedBy { it.loadLabel(pm).toString() }
                .forEach { app ->
                val appInfo = Arguments.createMap().apply {
                    putString("packageName", app.packageName)
                    putString("appName", app.loadLabel(pm).toString())
                }
                appList.pushMap(appInfo)
                }

            promise.resolve(appList)
            Log.i(TAG, "已获取 ${appList.size()} 个已安装应用")
        } catch (e: Exception) {
            Log.e(TAG, "获取已安装应用失败", e)
            promise.reject("ERROR", "获取已安装应用失败", e)
        }
    }

    /**
     * 检查通知监听权限
     *
     * @return 权限状态字符串
     */
    private fun checkNotificationListenerPermission(): String {
        return try {
            val packageName = reactContext.packageName
            val enabledListeners = Settings.Secure.getString(
                reactContext.contentResolver,
                "enabled_notification_listeners"
            )
            
            when {
                enabledListeners == null -> PERMISSION_UNKNOWN
                enabledListeners.contains(packageName) -> PERMISSION_AUTHORIZED
                else -> PERMISSION_DENIED
            }
        } catch (e: Exception) {
            Log.e(TAG, "检查通知监听权限失败", e)
            PERMISSION_UNKNOWN
        }
    }

    /**
     * 注册账单创建广播接收器
     */
    private fun registerPaymentReceiver() {
        if (isReceiverRegistered) {
            Log.d(TAG, "账单创建广播接收器已注册")
            return
        }

        paymentReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == PaymentOverlayManager.ACTION_BILL_CREATED) {
                    Log.d(TAG, "收到账单创建成功广播")
                    sendBillCreatedEventToJS()
                }
            }
        }

        val filter = IntentFilter(PaymentOverlayManager.ACTION_BILL_CREATED)
        LocalBroadcastManager.getInstance(reactContext).registerReceiver(paymentReceiver!!, filter)
        isReceiverRegistered = true

        Log.d(TAG, "账单创建广播接收器注册成功")
    }

    /**
     * 注销支付通知广播接收器
     */
    private fun unregisterPaymentReceiver() {
        if (!isReceiverRegistered || paymentReceiver == null) {
            return
        }
        
        try {
            LocalBroadcastManager.getInstance(reactContext).unregisterReceiver(paymentReceiver!!)
            paymentReceiver = null
            isReceiverRegistered = false
            Log.d(TAG, "支付广播接收器已注销")
        } catch (e: Exception) {
            Log.e(TAG, "注销支付广播接收器失败", e)
        }
    }

    /**
     * 发送账单创建成功事件到 JavaScript 层
     */
    private fun sendBillCreatedEventToJS() {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_BILL_CREATED, null)

            Log.d(TAG, "账单创建事件已发送到JS")
        } catch (e: Exception) {
            Log.e(TAG, "发送账单创建事件到JS失败", e)
        }
    }

    // LifecycleEventListener 实现

    override fun onHostResume() {
        registerPaymentReceiver()
    }

    override fun onHostPause() {
        // 保持接收器注册，以便在后台也能接收事件
    }

    override fun onHostDestroy() {
        unregisterPaymentReceiver()
    }
}

private data class SoundLibraryItem(
    val id: String,
    val name: String,
    val sourceUri: String,
    val soundUri: String,
    val startMs: Long,
    val endMs: Long,
    val durationMs: Long,
    val createdAt: Long
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("sourceUri", sourceUri)
        put("soundUri", soundUri)
        put("startMs", startMs)
        put("endMs", endMs)
        put("durationMs", durationMs)
        put("createdAt", createdAt)
    }

    fun toWritableMap(): WritableMap = Arguments.createMap().apply {
        putString("id", id)
        putString("name", name)
        putString("sourceUri", sourceUri)
        putString("soundUri", soundUri)
        putDouble("startMs", startMs.toDouble())
        putDouble("endMs", endMs.toDouble())
        putDouble("durationMs", durationMs.toDouble())
        putDouble("createdAt", createdAt.toDouble())
    }

    companion object {
        fun fromJson(json: JSONObject?): SoundLibraryItem? {
            if (json == null) return null
            val id = json.optString("id")
            val name = json.optString("name", "自定义铃声")
            val sourceUri = json.optString("sourceUri")
            val soundUri = json.optString("soundUri", sourceUri)
            val durationMs = json.optLong("durationMs", 0L)
            if (id.isBlank() || sourceUri.isBlank() || durationMs <= 0L) return null
            return SoundLibraryItem(
                id = id,
                name = name,
                sourceUri = sourceUri,
                soundUri = soundUri,
                startMs = json.optLong("startMs", 0L),
                endMs = json.optLong("endMs", durationMs),
                durationMs = durationMs,
                createdAt = json.optLong("createdAt", System.currentTimeMillis())
            )
        }
    }
}
