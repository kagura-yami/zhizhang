package com.zhizhang.shortcut

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.zhizhang.BuildConfig
import com.zhizhang.R
import com.zhizhang.auth.AuthTokenModule
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * 不打断当前应用的轻量语音记账层。
 *
 * 入口来自桌面组件、通知栏 Tile 或边缘手势，使用系统 SpeechRecognizer 和一个
 * 小型 WindowManager 悬浮条完成录音/识别，整个过程不会启动或切换 MainActivity。
 */
class VoiceCaptureService : Service() {
    companion object {
        private const val CHANNEL_ID = "voice_capture"
        private const val NOTIFICATION_ID = 7782
        private const val TAG = "VoiceCaptureService"
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        private val client = OkHttpClient.Builder().addInterceptor(com.zhizhang.auth.DeviceSession.interceptor())
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var windowManager: WindowManager? = null
    private var panel: LinearLayout? = null
    private var statusText: TextView? = null
    private var recognizer: SpeechRecognizer? = null
    private var finished = false

    override fun onCreate() {
        super.onCreate()
        // Android 14 会在启动 microphone 类型前台服务时强制校验录音权限；
        // 没有权限时直接结束服务，避免系统抛 SecurityException 把应用带崩。
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            android.util.Log.w(TAG, "未授予麦克风权限，取消语音悬浮层")
            stopSelf()
            return
        }
        createChannel()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification(),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification())
        }
        showPanel()
        startRecognition()
    }

    private fun showPanel() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val density = resources.displayMetrics.density
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding((16 * density).toInt(), (10 * density).toInt(), (8 * density).toInt(), (10 * density).toInt())
            background = GradientDrawable().apply {
                setColor(0xF01E293B.toInt())
                cornerRadius = 28 * density
                setStroke((1 * density).toInt(), 0x6638BDF8)
            }
            elevation = 12 * density
        }
        val icon = TextView(this).apply {
            text = "🎙"
            textSize = 20f
        }
        statusText = TextView(this).apply {
            text = "正在聆听…"
            textSize = 15f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding((8 * density).toInt(), 0, (10 * density).toInt(), 0)
            maxLines = 2
        }
        val stop = Button(this).apply {
            text = "结束"
            textSize = 13f
            isAllCaps = false
            setTextColor(0xFFFFFFFF.toInt())
            background = GradientDrawable().apply {
                setColor(0xFF2563EB.toInt())
                cornerRadius = 18 * density
            }
            setPadding((12 * density).toInt(), 0, (12 * density).toInt(), 0)
            setOnClickListener { finishRecording(null) }
        }
        root.addView(icon, LinearLayout.LayoutParams((34 * density).toInt(), (40 * density).toInt()))
        root.addView(statusText, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(stop, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, (40 * density).toInt()))

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = (64 * density).toInt()
        }
        runCatching {
            windowManager?.addView(root, params)
            panel = root
        }.onFailure {
            android.util.Log.w(TAG, "无法显示语音悬浮条", it)
            stopSelf()
        }
    }

    private fun startRecognition() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            statusText?.text = "请先开启麦克风权限"
            mainHandler.postDelayed({ stopCapture() }, 1600)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            statusText?.text = "系统语音识别不可用"
            mainHandler.postDelayed({ stopCapture() }, 1600)
            return
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this).also { speech ->
            speech.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: android.os.Bundle?) { statusText?.text = "正在聆听…" }
                override fun onBeginningOfSpeech() { statusText?.text = "正在聆听…" }
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() { statusText?.text = "正在识别…" }
                override fun onPartialResults(partialResults: android.os.Bundle?) {
                    val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    if (!text.isNullOrBlank()) statusText?.text = text
                }
                override fun onResults(results: android.os.Bundle?) {
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    finishRecording(text)
                }
                override fun onError(error: Int) {
                    if (!finished) {
                        statusText?.text = "没有听清，请重试"
                        mainHandler.postDelayed({ stopCapture() }, 1200)
                    }
                }
                override fun onEvent(eventType: Int, params: android.os.Bundle?) = Unit
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.SIMPLIFIED_CHINESE.toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            speech.startListening(intent)
        }
    }

    private fun finishRecording(text: String?) {
        if (finished) return
        finished = true
        recognizer?.stopListening()
        recognizer?.cancel()
        val content = text?.trim().orEmpty()
        if (content.isBlank()) {
            statusText?.text = "没有识别到内容"
            mainHandler.postDelayed({ stopCapture() }, 900)
            return
        }
        statusText?.text = "正在记账…"
        Thread { sendToAssistant(content) }.start()
    }

    private fun sendToAssistant(content: String) {
        try {
            val token = AuthTokenModule.getToken(this)
            if (token.isNullOrBlank()) {
                updateStatus("请先登录知账")
                return
            }
            val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')
            val body = JSONObject().put("content", content).toString().toRequestBody(JSON_TYPE)
            val requestBuilder = Request.Builder().url("$baseUrl/ai/chat/send").post(body)
            requestBuilder.addHeader("Authorization", "Bearer $token")
            client.newCall(requestBuilder.build()).execute().use { response ->
                if (!response.isSuccessful) {
                    updateStatus("记账失败，请稍后重试")
                    return
                }
                val payload = JSONObject(response.body?.string().orEmpty())
                if (payload.optBoolean("success", false)) updateStatus("已完成记账") else updateStatus("未完成记账")
            }
        } catch (error: Exception) {
            android.util.Log.w(TAG, "语音记账请求失败", error)
            updateStatus("网络异常，请稍后重试")
        }
    }

    private fun updateStatus(text: String) {
        mainHandler.post {
            statusText?.text = text
            mainHandler.postDelayed({ stopCapture() }, 1500)
        }
    }

    private fun stopCapture() {
        if (!finished) {
            finished = true
            recognizer?.cancel()
        }
        stopSelf()
    }

    override fun onDestroy() {
        recognizer?.destroy()
        recognizer = null
        runCatching { panel?.let { windowManager?.removeView(it) } }
        panel = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "语音记账", NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    private fun notification(): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("知账正在聆听")
        .setContentText("语音结束后会自动记录到账本")
        .setOngoing(true)
        .setSilent(true)
        .build()
}
