package com.zhizhang

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

class MainActivity : ReactActivity() {

  companion object { const val ACTION_VOICE_INPUT = "com.zhizhang.action.VOICE_INPUT" }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (intent?.action == ACTION_VOICE_INPUT) markVoiceRequest()
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent?.action == ACTION_VOICE_INPUT) markVoiceRequest()
  }

  override fun onResume() {
    super.onResume()
    if (getSharedPreferences("voice_shortcut", MODE_PRIVATE).getBoolean("pending_voice", false)) {
      Handler(Looper.getMainLooper()).postDelayed({
        (application as? MainApplication)?.reactNativeHost?.reactInstanceManager?.currentReactContext?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit("voiceInputRequested", null)
      }, 700)
    }
  }

  private fun markVoiceRequest() {
    // 先落盘再尝试广播，避免桌面组件/边缘手势在 React Native 监听器
    // 尚未挂载时丢失事件；全局 VoiceInputOverlay 会在挂载后消费 pending 请求。
    getSharedPreferences("voice_shortcut", MODE_PRIVATE).edit().putBoolean("pending_voice", true).apply()
    val context = (application as? MainApplication)?.reactNativeHost?.reactInstanceManager?.currentReactContext
    if (context != null) {
      context.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("voiceInputRequested", null)
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "zhizhang"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
