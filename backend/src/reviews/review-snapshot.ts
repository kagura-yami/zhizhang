import { Prisma } from '@prisma/client';

/** Never copy a full Bill into social data. */
export function reviewSnapshot(bill: { amount: { toFixed: (digits: number) => string }; type: string; date: Date; time?: Date | null; category?: { name: string } | null }): Prisma.InputJsonObject {
  return { amount: bill.amount.toFixed(4), type: bill.type, date: bill.date.toISOString().slice(0, 10), time: bill.time?.toISOString() ?? null, category: bill.category?.name ?? null };
}
