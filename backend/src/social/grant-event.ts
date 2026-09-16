import { ReviewGrant } from '@prisma/client';
import { SocialTx } from './social-access.service';

export async function recordGrantEvent(tx: SocialTx, grant: ReviewGrant) {
  await tx.socialInboxEvent.create({ data: {
    userId: grant.reviewerId, kind: 'review_grant_updated',
    dedupeKey: `grant:${grant.ownerId}:${grant.reviewerId}:${grant.version}`,
    payload: { ownerId: grant.ownerId, reviewerId: grant.reviewerId, version: grant.version },
  } });
}
