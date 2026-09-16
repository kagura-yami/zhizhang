import { httpService } from '../http';
import type { ApiResponse } from '../../types/api';

export const SOCIAL_CONSENT_VERSION = '2026-09-16';
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
