import { Bill, Prisma } from '@prisma/client';
import { SocialAccessService, SocialTx } from '../social/social-access.service';

const access = new SocialAccessService();
export function newBillWindowMs() {
  const seconds = Number(process.env.NEW_BILL_NOTICE_WINDOW_SECONDS || 60);
  return (Number.isFinite(seconds) ? Math.max(5, Math.min(300, Math.floor(seconds))) : 60) * 1000;
}

/** Called inside the bill creation transaction while holding its owner's lock. */
export async function captureNewBill(tx: SocialTx, bill: Bill) {
  const dueAt = new Date(bill.createdAt.getTime() + newBillWindowMs());
  // Set-based fanout keeps database round trips constant even with many reviewers.
  // The owner lock serializes capture against grant changes, blocking and other bill creation.
  await tx.$executeRaw(Prisma.sql`
    WITH eligible AS MATERIALIZED (
      SELECT g.reviewer_id, g.activated_at, n.id AS notice_id
      FROM public.review_grants g
      JOIN public.users owner ON owner.id = g.owner_id AND owner.is_active
      JOIN public.social_preferences op ON op.user_id = owner.id
      JOIN public.users reviewer ON reviewer.id = g.reviewer_id AND reviewer.is_active
      JOIN public.social_preferences rp ON rp.user_id = reviewer.id
      LEFT JOIN LATERAL (
        SELECT id FROM public.new_bill_notices n
        WHERE n.owner_id = g.owner_id AND n.reviewer_id = g.reviewer_id
          AND n.grant_activated_at = g.activated_at AND n.processed_at IS NULL
          AND n.due_at > ${bill.createdAt} ORDER BY id LIMIT 1
      ) n ON true
      WHERE g.owner_id = ${bill.userId}::uuid AND g.status = 'active'
        AND g.reviewer_id <> g.owner_id AND g.scope IN ('both', ${bill.type})
        AND ${bill.date}::date >= COALESCE(g.history_start, (g.activated_at AT TIME ZONE 'Asia/Shanghai')::date)
        AND (g.history_start IS NOT NULL OR g.activated_at <= ${bill.createdAt})
        AND NOT EXISTS (SELECT 1 FROM public.social_blocks b
          WHERE (b.blocker_id = g.owner_id AND b.blocked_id = g.reviewer_id)
            OR (b.blocker_id = g.reviewer_id AND b.blocked_id = g.owner_id))
    ), added AS (
      INSERT INTO public.new_bill_notices (owner_id, reviewer_id, grant_activated_at, created_at, due_at)
      SELECT ${bill.userId}::uuid, reviewer_id, activated_at, ${bill.createdAt}, ${dueAt}
      FROM eligible WHERE notice_id IS NULL RETURNING id
    ), batches AS (
      SELECT notice_id AS id FROM eligible WHERE notice_id IS NOT NULL UNION ALL SELECT id FROM added
    )
    INSERT INTO public.new_bill_notice_items (notice_id, bill_id)
    SELECT id, ${bill.id} FROM batches ON CONFLICT (notice_id, bill_id) DO NOTHING`);
}

/** Used both when producing the inbox event and when rendering it, under ordered participant locks. */
export async function visibleNotice(tx: SocialTx, userId: string, noticeId: number) {
  const notice = await tx.newBillNotice.findUnique({ where: { id: noticeId } });
  if (!notice || notice.reviewerId !== userId) return null;
  let grant;
  try { grant = await access.grant(tx, notice.ownerId, userId); }
  catch (error) { if ([403, 404].includes(error?.getStatus?.())) return null; throw error; }
  if (grant.activatedAt.getTime() !== notice.grantActivatedAt.getTime()) return null;
  const where = { ...access.billWhere(grant), newBillNoticeItems: { some: { noticeId } } };
  const count = await tx.bill.count({ where });
  return count ? { ownerId: notice.ownerId, noticeId, count, where } : null;
}
