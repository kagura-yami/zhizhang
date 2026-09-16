import { useCallback } from 'react';
import { useAuth } from '../providers';
import { useSocialResource } from '../screens/social/shared';
import { getCashHistory } from '../services/api/ledger';

export function useAssetsData() {
  const { token } = useAuth();
  return useSocialResource(useCallback(() => getCashHistory(token || ''), [token]));
}
