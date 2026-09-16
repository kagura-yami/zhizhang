import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appVersionApi } from '../src/services/api/appVersion';
import { useAppUpdate } from '../src/hooks/useAppUpdate';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-fs', () => ({ CachesDirectoryPath: '/cache', exists: jest.fn(), unlink: jest.fn(), downloadFile: jest.fn(), moveFile: jest.fn(), stopDownload: jest.fn() }));
const mockAlert = jest.fn();
jest.mock('../src/providers', () => ({ useAlert: () => ({ alert: mockAlert }) }));
jest.mock('../src/services/api/appVersion', () => ({ appVersionApi: { checkUpdate: jest.fn() } }));
jest.mock('../src/utils/appVersion', () => ({ getInstalledAppVersion: async () => '0.0.151', getInstalledAppVersionSync: () => '0.0.151' }));
let state: ReturnType<typeof useAppUpdate>, root: Renderer.ReactTestRenderer;
let files: Set<string>, finish: () => void, options: any;
function Harness() { state = useAppUpdate({ autoCheck: false }); return null; }
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear(); Platform.OS = 'android'; files = new Set();
  NativeModules.InstallApk = { validateApk: jest.fn(async (p: string) => files.has(p)), install: jest.fn(async () => true), notifyUpdateAvailable: jest.fn(async () => true) };
  (RNFS.exists as jest.Mock).mockImplementation(async p => files.has(p));
  (RNFS.unlink as jest.Mock).mockImplementation(async p => { files.delete(p); });
  (RNFS.moveFile as jest.Mock).mockImplementation(async (a, b) => { files.delete(a); files.add(b); });
  (RNFS.downloadFile as jest.Mock).mockImplementation(opts => {
    options = opts;
    return { jobId: 1, promise: new Promise(resolve => { finish = () => { files.add(opts.toFile); resolve({ statusCode: 200 }); }; }) };
  });
  (appVersionApi.checkUpdate as jest.Mock).mockResolvedValue({ hasUpdate: true, latestVersion: { version: '0.0.152', downloadUrl: 'https://example.invalid/app.apk' } });
  await act(async () => { root = Renderer.create(<Harness />); });
});
afterEach(async () => { await act(async () => root.unmount()); });
async function check() { await act(async () => { await state.checkUpdate(); }); await flush(); }
async function ready() { await check(); await act(async () => { finish(); }); await flush(); }
test('manual check exposes download and progress despite automatic download being enabled', async () => {
  await check(); expect(state.showModal).toBe(true); expect(state.downloading).toBe(true);
  await act(async () => options.progress({ bytesWritten: 55, contentLength: 100 }));
  expect(state.progress).toBe(55);
  await act(async () => finish()); await flush();
  expect(state.progress).toBe(100); expect(state.downloading).toBe(false);
  expect(state.downloadedVersion).toBe('0.0.152');
  expect(options.connectionTimeout).toBe(15000); expect(options.readTimeout).toBe(60000);
});
test('installer rejection is reported and does not dismiss the update as successful', async () => {
  await ready(); NativeModules.InstallApk.install.mockRejectedValue(new Error('请允许知账安装应用'));
  let started; await act(async () => { started = await state.downloadAndInstall(); });
  expect(started).toBe(false); expect(state.showModal).toBe(true);
  expect(mockAlert).toHaveBeenCalledWith('安装未启动', '请允许知账安装应用');
});
test('cache reclaimed after download is downloaded again before installer launch', async () => {
  await ready(); files.clear(); let install: Promise<boolean>;
  await act(async () => { install = state.downloadAndInstall(); }); await flush();
  expect(RNFS.downloadFile).toHaveBeenCalledTimes(2); expect(NativeModules.InstallApk.install).not.toHaveBeenCalled();
  let started; await act(async () => { finish(); started = await install!; });
  expect(started).toBe(true); expect(NativeModules.InstallApk.install).toHaveBeenCalledTimes(1);
  expect(state.showModal).toBe(false);
});
test('invalid partial download is removed and cannot reach installer', async () => {
  NativeModules.InstallApk.validateApk.mockResolvedValue(false);
  await ready(); expect(files.size).toBe(0); expect(state.downloadedVersion).toBeNull();
  expect(mockAlert).toHaveBeenCalledWith('下载失败', '下载的安装包校验失败');
  expect(NativeModules.InstallApk.install).not.toHaveBeenCalled();
});
