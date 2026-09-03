package com.zhizhang.widget

import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/** 桌面组件后台同步任务。仅发起显式刷新广播，网络请求仍由组件的 goAsync 执行。 */
class FinanceWidgetSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        applicationContext.sendBroadcast(
            Intent(applicationContext, FinanceOverviewWidget::class.java)
                .setAction(FinanceOverviewWidget.ACTION_DATA_CHANGED)
        )
        return Result.success()
    }
}
