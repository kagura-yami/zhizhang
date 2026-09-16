import { BadRequestException } from '@nestjs/common';

/** Bill.date is a PostgreSQL DATE; never convert it through the server's local timezone. */
export function businessDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('日期必须为 YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('日期不存在');
  }
  return date;
}

export function businessPeriod(startDate: string, endDate: string) {
  const start = businessDate(startDate);
  const end = businessDate(endDate);
  if (start > end) throw new BadRequestException('开始日期不能晚于结束日期');
  // Covers leap years, while preventing accidental unbounded scans per request.
  if (end.getTime() - start.getTime() > 365 * 86400000) {
    throw new BadRequestException('单次统计最多包含 366 个自然日');
  }
  return { start, end };
}

/** Closed natural periods for retrospectives, always in UTC+8. */
export function closedReviewPeriod(kind: 'day' | 'month', key: string, now = new Date()) {
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  if (kind === 'day') {
    businessDate(key);
    if (key >= today) throw new BadRequestException('只能复盘已结束的自然日');
    return businessPeriod(key, key);
  }
  if (!/^\d{4}-\d{2}$/.test(key)) throw new BadRequestException('月份必须为 YYYY-MM');
  const start = businessDate(`${key}-01`);
  if (key >= today.slice(0, 7)) throw new BadRequestException('只能复盘已结束的自然月');
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = new Date(next.getTime() - 86400000);
  return { start, end };
}
