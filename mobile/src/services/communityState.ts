import { DeviceEventEmitter } from 'react-native';
import { storage } from '../utils/storage';

const values = new Map<string, boolean>();
const reads = new Map<string, Promise<boolean | undefined>>();
const writes = new Map<string, Promise<void>>();
const keyFor = (id: string) => `community-enabled:v1:${id}`;
export const COMMUNITY_CHANGED = 'communityChanged';

// Persist only the account's navigation preference, never social content or permissions.
export function restoreCommunityState(id: string): Promise<boolean | undefined> {
  if (values.has(id)) return Promise.resolve(values.get(id));
  const pending = reads.get(id);
  if (pending) return pending;
  const read = storage.getItem<boolean>(keyFor(id)).then(value => {
    if (!values.has(id) && typeof value === 'boolean') values.set(id, value);
    return values.get(id);
  }).finally(() => reads.delete(id));
  reads.set(id, read);
  return read;
}

export function saveCommunityState(userId: string, enabled: boolean): Promise<void> {
  values.set(userId, enabled);
  DeviceEventEmitter.emit(COMMUNITY_CHANGED, { userId, enabled });
  const write = (writes.get(userId) || Promise.resolve()).then(() => storage.setItem(keyFor(userId), enabled)).catch(() => {
    // A storage failure must not revert a successful server-side preference change.
  });
  writes.set(userId, write);
  return write;
}
