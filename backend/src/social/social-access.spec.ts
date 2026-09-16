import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SocialAccessService } from './social-access.service';
import { EnableSocialDto, SaveGrantDto, SocialPreferencesDto } from './social.dto';

describe('社群权限基础', () => {
  const access = new SocialAccessService();
  it('仅新账单同时按创建时点和北京时间日期过滤', () => {
    const activatedAt = new Date('2026-09-16T16:30:00Z');
    const where = access.billWhere({ ownerId: 'owner', scope: 'expense', activatedAt, historyStart: null } as any);
    expect(where).toEqual({ userId: 'owner', type: 'expense', createdAt: { gte: activatedAt }, date: { gte: new Date('2026-09-17T00:00:00Z') } });
  });
  it('历史授权只开放指定日期后的业务日期', () => {
    const historyStart = new Date('2026-09-01T00:00:00Z');
    expect(access.billWhere({ ownerId: 'owner', scope: 'both', activatedAt: new Date(), historyStart } as any)).toEqual({ userId: 'owner', date: { gte: historyStart } });
  });
  it('旧版同意和隐私字段 null 不会被接受', async () => {
    expect((await validate(plainToInstance(EnableSocialDto, { consentVersion: 'old' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(SocialPreferencesDto, { allowAiFeedback: null }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(SocialPreferencesDto, { allowAiAuthoredFeedback: null }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(SocialPreferencesDto, { allowAiAuthoredFeedback: false }))).toHaveLength(0);
    expect(await validate(plainToInstance(EnableSocialDto, { consentVersion: '2026-09-16' }))).toHaveLength(0);
  });
  it('历史开关允许 null，但授权版本不允许 null', async () => {
    expect(await validate(plainToInstance(SaveGrantDto, { scope: 'expense', historyStart: null }))).toHaveLength(0);
    expect((await validate(plainToInstance(SaveGrantDto, { scope: 'expense', expectedVersion: null }))).length).toBeGreaterThan(0);
  });
});
