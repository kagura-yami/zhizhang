import { Decimal } from '@prisma/client/runtime/library';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { reviewSnapshot } from './review-snapshot';
import { visibleReviewMessage } from './reviews.service';
import { ChangeReviewMessageDto, NewReviewMessageDto } from './reviews.dto';

describe('私密评账投影', () => {
  it('快照只保留允许的业务字段', () => {
    const bill = { amount: new Decimal('32.1234'), type: 'expense', date: new Date('2026-09-16'), description: 'secret', notes: 'raw notification', counterparty: 'merchant', category: { name: '餐饮' } };
    expect(reviewSnapshot(bill)).toEqual({ amount: '32.1234', type: 'expense', date: '2026-09-16', time: null, category: '餐饮' });
  });
  it.each([{ hidden: true, withdrawn: false }, { hidden: false, withdrawn: true }])('隐藏与撤回都不直接输出原文 %p', flags => {
    expect(visibleReviewMessage({ id: 1, mainSlot: 1, body: 'private', ...flags } as any).body).toBeNull();
  });
  it('拒绝空白消息、过长消息和缺少正文的编辑', async () => {
    const input = { clientKey: '11111111-1111-4111-8111-111111111111', body: '正常内容' };
    expect(await validate(plainToInstance(NewReviewMessageDto, input))).toHaveLength(0);
    for (const body of ['  \n ', 'x'.repeat(2001)]) expect((await validate(plainToInstance(NewReviewMessageDto, { ...input, body }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(ChangeReviewMessageDto, { action: 'edit', expectedRevision: 1 }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(ChangeReviewMessageDto, { action: 'withdraw', expectedRevision: 1 }))).toHaveLength(0);
  });
});
