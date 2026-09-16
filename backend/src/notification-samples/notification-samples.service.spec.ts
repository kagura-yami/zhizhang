import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationSamplesService } from './notification-samples.service';
import { NotificationSampleQueryDto, UploadNotificationSamplesDto } from './notification-samples.dto';

describe('通知样本留档', () => {
  const sample = {
    sampleId: 'a'.repeat(64), packageName: 'com.eg.android.AlipayGphone', appVersion: '0.0.136', ruleVersion: '2026-09-16.2',
    postedAt: '2026-09-16T01:00:00.000Z', capturedAt: '2026-09-16T01:00:01.000Z', status: 'ignored', reason: '优惠提醒',
    raw: { title: '支付宝卡包', text: '5元红包今晚失效' },
  };
  const prisma = { notificationSample: { createMany: jest.fn(), findMany: jest.fn(), count: jest.fn() }, $transaction: jest.fn() };
  const service = new NotificationSamplesService(prisma as any);
  beforeEach(() => jest.clearAllMocks());

  it('以认证用户归档，重复上传幂等，仍返回确认 ID', async () => {
    prisma.notificationSample.createMany.mockResolvedValue({ count: 0 });
    const result = await service.upload('authenticated-user', { samples: [{ ...sample, userId: 'forged-user' } as any] });
    expect(prisma.notificationSample.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ userId: 'authenticated-user', raw: sample.raw })] }));
    expect(result.acceptedIds).toEqual([sample.sampleId]);
  });
  it('拒绝过大原文，不能写入数据库', async () => {
    await expect(service.upload('user', { samples: [{ ...sample, raw: { text: 'a'.repeat(129 * 1024) } }] })).rejects.toThrow('128KB');
    expect(prisma.notificationSample.createMany).not.toHaveBeenCalled();
  });
  it('分页和导出保留相同筛选，导出采用稳定 ID 游标', async () => {
    const query = Object.assign(new NotificationSampleQueryDto(), { userId: 'user', status: 'ignored', ruleVersion: sample.ruleVersion, afterId: 40 });
    prisma.notificationSample.findMany.mockResolvedValue([{ id: 41 }]);
    const data = await service.export(query);
    expect(prisma.notificationSample.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user', status: 'ignored', id: { gt: 40 } }), take: 1000, orderBy: { id: 'asc' } }));
    expect(data.nextAfterId).toBeNull();
  });
  it('验证嵌套样本和批次上限', async () => {
    const valid = plainToInstance(UploadNotificationSamplesDto, { samples: [sample] });
    expect(await validate(valid)).toHaveLength(0);
    expect((await validate(plainToInstance(UploadNotificationSamplesDto, { samples: [{ ...sample, status: 'fake' }] }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(UploadNotificationSamplesDto, { samples: Array(26).fill(sample) }))).length).toBeGreaterThan(0);
  });
});
