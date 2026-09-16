import { httpService } from '../http';
import type { ApiResponse } from '../../types/api';

export const SOCIAL_CONSENT_VERSION = '2026-09-16';
export const REPORT_DISCLOSURE_VERSION = '2026-09-16';
export interface BillFeedback {
  billId: number;
  hang: number;
  la: number;
  hasUnreadText: boolean;
}
export interface OwnerReviewSummary {
  hang: number;
  la: number;
  threads: { id: number; vote: ReviewVote; reviewer: SocialPerson }[];
}
export type InboxTarget =
  | { type: 'review'; threadId: number; billId: number; messageId: number }
  | { type: 'bills'; ownerId: string; count: number }
  | { type: 'profile'; userId: string }
  | {
      type: 'grant';
      ownerId: string;
      scope: string;
      historyStart: string | null;
    }
  | { type: 'request'; ownerId: string; applicantId: string; status: string }
  | { type: 'report'; reportId: number; status: string; reason: string | null };
export interface InboxItem {
  id: number;
  kind: string;
  createdAt: string;
  unread: boolean;
  title: string;
  target: InboxTarget;
  preview: string | null;
  readReceipt: string;
  systemNotificationEnabled: boolean;
}
export interface InboxPage {
  items: InboxItem[];
  nextBefore: number;
  hasMore: boolean;
  receipt: string | null;
}
export interface ReviewReport {
  id: number;
  originalMessageId: number;
  reportedRevision: number;
  reason: string;
  status: 'pending' | 'upheld' | 'dismissed';
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export type ReviewVote = 'hang' | 'la';
export interface SharedBill {
  id?: number;
  amount: string;
  type: string;
  date: string;
  time: string | null;
  category: string | null;
}
export interface ReviewMessage {
  id: number;
  authorId: string;
  isMain: boolean;
  body: string | null;
  withdrawn: boolean;
  hidden: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface ReviewDetail {
  pageNumber: number;
  unreadOnPage: number;
  readReceipt: string | null;
  id: number;
  originalBillId: number;
  vote: ReviewVote;
  isOwner: boolean;
  canWrite: boolean;
  hasMain: boolean;
  otherPerson: SocialPerson | null;
  snapshot: SharedBill;
  deleted: boolean;
  billModified: boolean;
  mainWithdrawn: boolean;
  messages: ReviewMessage[];
}
export interface ReviewVersion {
  revision: number;
  body: string;
  withdrawn: boolean;
  action: string;
  createdAt: string;
}
export interface ReceivedReview {
  id: number;
  originalBillId: number;
  vote: ReviewVote;
  snapshot: SharedBill;
  deletedAt: string | null;
  reviewer: SocialPerson;
}
export interface ReceivedBillReview {
  originalBillId: number;
  snapshot: SharedBill;
  deletedAt: string | null;
  hang: number;
  la: number;
}
export interface ReviewableOwner {
  owner: SocialPerson;
  scope: string;
  historyStart: string | null;
  pendingCount: number;
  reviewedCount: number;
}
export interface ReviewRequest {
  ownerId: string;
  applicantId: string;
  version: number;
  status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'system_cancelled';
  requestedAt: string;
  decidedAt: string | null;
  owner: SocialPerson;
  applicant: SocialPerson;
}
export interface RequestContext {
  request: Omit<ReviewRequest, 'owner' | 'applicant'> | null;
  pendingCount: number;
  pendingLimit: number;
  cooldownUntil: string | null;
}
export interface SocialPerson {
  id: string;
  nickname: string | null;
  avatar: string | null;
  following?: boolean;
  followedBy?: boolean;
  friend?: boolean;
}
export interface SocialPreferences {
  allowAiFeedback: boolean;
  allowAiAuthoredFeedback: boolean;
  publicRelations: boolean;
  rankingScope: 'none' | 'friends' | 'global';
  showRankingAmount: boolean;
  notifyNewBills: boolean;
  notifyInteractions: boolean;
  notificationPreview: boolean;
}
export interface SocialStatus {
  enabled: boolean;
  requiredConsentVersion: string;
  preference: SocialPreferences | null;
}
export interface ReviewGrant {
  ownerId: string;
  reviewerId: string;
  scope: 'expense' | 'income' | 'both';
  historyStart: string | null;
  activatedAt: string;
  status: 'active' | 'revoked' | 'exited';
  version: number;
}
export type PeopleMode =
  | 'search'
  | 'following'
  | 'followers'
  | 'friends'
  | 'blocks';
async function data<T>(request: Promise<ApiResponse<T>>): Promise<T> {
  const response = await request;
  if (!response.success || response.data == null)
    throw new Error(response.message || '请求失败，请重试');
  return response.data;
}
export function createSocialApi(token: string) {
  // Bind requests to the session that rendered the controls, including delayed interceptor work.
  const config = { headers: { Authorization: `Bearer ${token}` } };
  return {
    billFeedback: (id: number) =>
      data<BillFeedback & { receipt: string }>(
        httpService.get(`/social/inbox/bills/${id}`, config),
      ),
    billFeedbackSummaries: (billIds: number[]) =>
      data<BillFeedback[]>(
        httpService.post('/social/inbox/bills/summary', { billIds }, config),
      ),
    ownerReviewSummary: (id: number, page: number) =>
      data<OwnerReviewSummary>(
        httpService.get(`/reviews/bills/${id}/summary`, {
          ...config,
          params: { page, pageSize: 20 },
        }),
      ),
    inboxEvent: (id: number) =>
      data<InboxItem>(httpService.get(`/social/inbox/events/${id}`, config)),
    inbox: (before: number) =>
      data<InboxPage>(
        httpService.get('/social/inbox', {
          ...config,
          params: { before, limit: 20 },
        }),
      ),
    readInbox: (receipt: string) =>
      data<{ count: number }>(
        httpService.post('/social/inbox/read', { receipt }, config),
      ),
    reportPreview: (thread: number, message: number) =>
      data<{ message: ReviewMessage; disclosureVersion: string }>(
        httpService.get(
          `/review-reports/threads/${thread}/messages/${message}`,
          config,
        ),
      ),
    reportReview: (
      thread: number,
      message: number,
      expectedRevision: number,
      reason: string,
    ) =>
      data<{ id: number; status: ReviewReport['status'] }>(
        httpService.post(
          `/review-reports/threads/${thread}/messages/${message}`,
          {
            expectedRevision,
            reason,
            acceptDisclosure: true,
            disclosureVersion: REPORT_DISCLOSURE_VERSION,
          },
          config,
        ),
      ),
    reports: (page: number) =>
      data<ReviewReport[]>(
        httpService.get('/review-reports', {
          ...config,
          params: { page, pageSize: 20 },
        }),
      ),
    reviewableOwners: (page: number) =>
      data<{ items: ReviewableOwner[]; total: number }>(
        httpService.get('/social/reviewable-owners', {
          ...config,
          params: { page, pageSize: 20 },
        }),
      ),
    grantList: (direction: 'given' | 'received', page: number) =>
      data<(ReviewGrant & { owner: SocialPerson; reviewer: SocialPerson })[]>(
        httpService.get(`/social/grants/${direction}`, {
          ...config,
          params: { page, pageSize: 20 },
        }),
      ),
    receivedBillReviews: (page: number) =>
      data<ReceivedBillReview[]>(
        httpService.get('/reviews/mine/bills', {
          ...config,
          params: { page, pageSize: 20 },
        }),
      ),
    sharedBills: (
      id: string,
      page: number,
      state: 'pending' | 'reviewed' | 'all' = 'pending',
    ) =>
      data<{ grantVersion: number; total: number; items: SharedBill[] }>(
        httpService.get(`/social/owners/${id}/bills`, {
          ...config,
          params: { page, pageSize: 20, state },
        }),
      ),
    myVote: (id: number) =>
      data<{
        thread: { id: number; vote: ReviewVote } | null;
        snapshot: SharedBill;
      }>(httpService.get(`/reviews/bills/${id}/mine`, config)),
    vote: (id: number, vote: ReviewVote) =>
      data<{ threadId: number; vote: ReviewVote }>(
        httpService.put(`/reviews/bills/${id}/vote`, { vote }, config),
      ),
    receivedReviews: (page: number) =>
      data<ReceivedReview[]>(
        httpService.get('/reviews/mine', {
          ...config,
          params: { page, pageSize: 20 },
        }),
      ),
    review: (id: number, page: number, aroundMessageId?: number) =>
      data<ReviewDetail>(
        httpService.get(`/reviews/threads/${id}`, {
          ...config,
          params: { page, pageSize: 20, ...(aroundMessageId === undefined ? {} : { aroundMessageId }) },
        }),
      ),
    sendReview: (id: number, main: boolean, body: string, clientKey: string) =>
      data<ReviewMessage>(
        httpService.post(
          `/reviews/threads/${id}/${main ? 'main' : 'replies'}`,
          { body, clientKey },
          config,
        ),
      ),
    changeReview: (
      id: number,
      message: number,
      expectedRevision: number,
      action: 'edit' | 'withdraw' | 'restore',
      body?: string,
    ) =>
      data<ReviewMessage>(
        httpService.patch(
          `/reviews/threads/${id}/messages/${message}`,
          { expectedRevision, action, body },
          config,
        ),
      ),
    reviewVersions: (id: number, message: number, page: number) =>
      data<ReviewVersion[]>(
        httpService.get(`/reviews/threads/${id}/messages/${message}/versions`, {
          ...config,
          params: { page, pageSize: 20 },
        }),
      ),
    requestContext: (id: string) =>
      data<RequestContext>(
        httpService.get(`/social/requests/to/${id}`, config),
      ),
    requests: (direction: 'incoming' | 'outgoing', page: number) =>
      data<ReviewRequest[]>(
        httpService.get(`/social/requests/${direction}`, {
          ...config,
          params: { page, pageSize: 20 },
        }),
      ),
    submitRequest: (id: string, expectedVersion?: number) =>
      data(
        httpService.post(
          `/social/requests/to/${id}`,
          { expectedVersion },
          config,
        ),
      ),
    withdrawRequest: (id: string, expectedVersion: number) =>
      data(
        httpService.post(
          `/social/requests/to/${id}/withdraw`,
          { expectedVersion },
          config,
        ),
      ),
    rejectRequest: (id: string, expectedVersion: number) =>
      data(
        httpService.post(
          `/social/requests/from/${id}/reject`,
          { expectedVersion },
          config,
        ),
      ),
    approveRequest: (
      id: string,
      values: {
        expectedVersion: number;
        scope: ReviewGrant['scope'];
        historyStart?: string;
      },
    ) =>
      data(
        httpService.post(`/social/requests/from/${id}/approve`, values, config),
      ),
    status: () => data<SocialStatus>(httpService.get('/social/me', config)),
    enable: () =>
      data<SocialPreferences>(
        httpService.post(
          '/social/enable',
          { consentVersion: SOCIAL_CONSENT_VERSION },
          config,
        ),
      ),
    preferences: (values: Partial<SocialPreferences>) =>
      data<SocialPreferences>(
        httpService.patch('/social/preferences', values, config),
      ),
    people: (userId: string, mode: PeopleMode, query: string, page: number) =>
      data<SocialPerson[]>(
        httpService.get(
          mode === 'search'
            ? '/social/users'
            : mode === 'blocks'
            ? '/social/blocks'
            : `/social/users/${userId}/relations/${mode}`,
          {
            ...config,
            params: {
              page,
              pageSize: 20,
              ...(mode === 'search' ? { query } : {}),
            },
          },
        ),
      ),
    person: (id: string) =>
      data<SocialPerson>(httpService.get(`/social/users/${id}`, config)),
    grants: (id: string) =>
      data<{ given: ReviewGrant | null; received: ReviewGrant | null }>(
        httpService.get(`/social/grants/with/${id}`, config),
      ),
    follow: (id: string, enabled: boolean) =>
      data(
        enabled
          ? httpService.put(`/social/following/${id}`, undefined, config)
          : httpService.delete(`/social/following/${id}`, config),
      ),
    block: (id: string, enabled: boolean) =>
      data(
        enabled
          ? httpService.put(`/social/blocks/${id}`, undefined, config)
          : httpService.delete(`/social/blocks/${id}`, config),
      ),
    grant: (
      id: string,
      values: {
        scope: ReviewGrant['scope'];
        historyStart?: string;
        expectedVersion?: number;
      },
    ) =>
      data<ReviewGrant>(
        httpService.put(`/social/grants/given/${id}`, values, config),
      ),
    endGrant: (id: string, exit: boolean) =>
      data(
        httpService.delete(
          `/social/grants/${exit ? 'received' : 'given'}/${id}`,
          config,
        ),
      ),
  };
}
