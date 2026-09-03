package com.zhizhang.shortcut

import android.graphics.drawable.Icon
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.zhizhang.R
import android.content.Intent
import androidx.core.content.ContextCompat

/** 系统通知栏快捷设置中的“知账语音”按钮。 */
class VoiceInputTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            label = "知账语音"
            state = Tile.STATE_INACTIVE
            icon = Icon.createWithResource(this@VoiceInputTileService, R.mipmap.ic_launcher)
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        qsTile?.apply {
            state = Tile.STATE_ACTIVE
            updateTile()
        }
        val launch = {
            // Tile 点击不打开 Activity，直接显示独立悬浮录音条。
            ContextCompat.startForegroundService(this, Intent(this, VoiceCaptureService::class.java))
        }
        if (isLocked) unlockAndRun(launch) else launch()
    }
}
