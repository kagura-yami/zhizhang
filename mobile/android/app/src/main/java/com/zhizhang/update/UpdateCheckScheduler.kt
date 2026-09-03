package com.zhizhang.update

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** 注册可跨进程、跨重启保留的后台更新检查任务。 */
object UpdateCheckScheduler {
    private const val PERIODIC_WORK_NAME = "zhizhang_periodic_update_check"
    private const val IMMEDIATE_WORK_NAME = "zhizhang_immediate_update_check"

    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val periodicRequest = PeriodicWorkRequestBuilder<UpdateCheckWorker>(1, TimeUnit.HOURS)
            .setInitialDelay(5, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()

        val immediateRequest = OneTimeWorkRequestBuilder<UpdateCheckWorker>()
            .setConstraints(constraints)
            .build()

        val workManager = WorkManager.getInstance(context.applicationContext)
        workManager.enqueueUniqueWork(
            IMMEDIATE_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            immediateRequest
        )
        workManager.enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            periodicRequest
        )
    }
}
