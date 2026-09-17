import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useCommunityState } from '../src/hooks/useCommunityState';
import { saveCommunityState } from '../src/services/communityState';
import { storage } from '../src/utils/storage';
import { createSocialApi } from '../src/services/api/social';
let mockAuth = { user: { id: 'a' }, token: 'token-a' };
jest.mock('../src/providers', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/utils/storage', () => ({ storage: { getItem: jest.fn(), setItem: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/services/api/social', () => ({ createSocialApi: jest.fn() }));
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
let current: ReturnType<typeof useCommunityState>;
function Probe() { current = useCommunityState(); return null; }
test('账户开关跨挂载保留，刷新不清空，旧账户响应和旧请求不能覆盖新设置', async () => {
  const initial = deferred<any>(), foreground = deferred<any>(), other = deferred<any>();
  const status = jest.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(foreground.promise).mockReturnValueOnce(other.promise).mockRejectedValue(new Error('offline'));
  (createSocialApi as jest.Mock).mockReturnValue({ status });
  (storage.getItem as jest.Mock).mockImplementation(async (key: string) => key.endsWith(':a') ? true : false);
  let listener!: (s:string)=>void;
  const spy = jest.spyOn(AppState,'addEventListener').mockImplementation((_,fn:any)=>{listener=fn;return {remove:jest.fn()};});
  let tree!: Renderer.ReactTestRenderer;
  await act(async()=>{tree=Renderer.create(<Probe/>);});
  expect(current!.enabled).toBe(true); // local preference restored before network
  await act(async()=>{listener('background');});
  expect(current!.enabled).toBe(true);
  await act(async()=>{listener('active');});
  expect(current!.enabled).toBe(true);
  await act(async()=>{initial.resolve({enabled:false});}); // superseded refresh
  expect(current!.enabled).toBe(true);
  await act(async()=>{await saveCommunityState('a',false);});
  await act(async()=>{foreground.resolve({enabled:true});}); // older than explicit disable
  expect(current!.enabled).toBe(false);
  await act(async()=>{await saveCommunityState('a',true);tree.unmount();});
  await act(async()=>{tree=Renderer.create(<Probe/>);});
  expect(current!.enabled).toBe(true); // navigation remount
  mockAuth={user:{id:'b'},token:'token-b'};
  await act(async()=>{tree.update(<Probe/>);});
  expect(current!.enabled).toBe(false);
  await act(async()=>{other.resolve({enabled:true});});
  expect(current!.enabled).toBe(false); // late A response cannot enable B
  await act(async()=>{await saveCommunityState('a',true);});
  expect(current!.enabled).toBe(false);
  mockAuth={user:{id:'a'},token:'new-token-a'};
  await act(async()=>{tree.update(<Probe/>);});
  expect(current!.enabled).toBe(true); // offline retains the account preference
  await act(async()=>{tree.unmount();});
  expect(storage.setItem).toHaveBeenLastCalledWith('community-enabled:v1:a',true);
  spy.mockRestore();
});
