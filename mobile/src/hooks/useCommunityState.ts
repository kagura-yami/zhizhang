import { useEffect, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { useAuth } from '../providers';
import { createSocialApi } from '../services/api/social';
import { COMMUNITY_CHANGED, restoreCommunityState, saveCommunityState } from '../services/communityState';

export function useCommunityState() {
  const { user, token } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState<{ userId?: string; enabled: boolean; ready: boolean }>({ enabled: false, ready: false });
  useEffect(() => {
    let alive = true, revision = 0;
    if (!userId || !token) {
      setState({ userId, enabled: false, ready: true });
      return;
    }
    const api = createSocialApi(token);
    const refresh = async () => {
      const request = ++revision;
      try {
        const status = await api.status();
        if (alive && request === revision) void saveCommunityState(userId, status.enabled);
      } catch {
        // Offline, refresh, and expired sessions do not mean the feature was disabled.
        // Auth owns session invalidation; the API still enforces all content permissions.
      }
    };
    const changed = DeviceEventEmitter.addListener(COMMUNITY_CHANGED, (value: { userId: string; enabled: boolean }) => {
      if (!alive || value?.userId !== userId) return;
      ++revision;
      setState({ userId, enabled: value.enabled, ready: true });
    });
    const foreground = AppState.addEventListener('change', value => {
      if (value === 'active') void refresh();
    });
    void restoreCommunityState(userId).then(enabled => {
      if (!alive) return;
      setState(previous => previous.userId === userId && previous.ready ? previous : { userId, enabled: enabled === true, ready: true });
      void refresh();
    });
    return () => { alive = false; ++revision; changed.remove(); foreground.remove(); };
  }, [userId, token]);
  return state.userId === userId ? state : { userId, enabled: false, ready: false };
}
