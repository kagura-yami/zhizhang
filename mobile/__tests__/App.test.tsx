/** App orchestration only: native UI, navigation and update transport are test doubles. */
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { DeviceEventEmitter, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('react-native-paper', () => ({
  Provider: ({ children }: any) => children,
  MD3DarkTheme: { colors: {} },
  MD3LightTheme: { colors: {} },
}));
jest.mock('../src/navigation/AppNavigator', () => {
  const { Text } = require('react-native');
  return () => <Text>navigation-boundary</Text>;
});
jest.mock('../src/components/UpdateModal', () => ({ UpdateModal: () => null }));
jest.mock('../src/providers', () => ({
  ThemeProvider: ({ children }: any) => children,
  AuthProvider: ({ children }: any) => children,
  AlertProvider: ({ children }: any) => children,
  useTheme: () => ({ isDark: false, colors: { primary: '#000000' } }),
  useAlert: jest.fn(),
}));
jest.mock('../src/hooks', () => ({
  useAppStateManager: jest.fn(),
  useAppUpdate: jest.fn(),
  useHotUpdate: jest.fn(),
}));
jest.mock('../src/lib/queryClient', () => ({
  ...jest.requireActual('../src/lib/queryClient'),
  invalidateCache: { bills: jest.fn() },
}));
// App captures this native module at import time.
NativeModules.PaymentNotificationModule = {};
const App = require('../App').default;
const { useAlert } = require('../src/providers');
const { useAppUpdate, useHotUpdate } = require('../src/hooks');
const { invalidateCache, queryClient } = require('../src/lib/queryClient');
const { UpdateModal } = require('../src/components/UpdateModal');
let root: Renderer.ReactTestRenderer | undefined;
const alert = jest.fn(),
  install = jest.fn(),
  hide = jest.fn();
const mount = async () => {
  await act(async () => {
    root = Renderer.create(<App />);
  });
};
const unmount = async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
};
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useAlert.mockReturnValue({ alert });
  useAppUpdate.mockReturnValue({
    showModal: false,
    latestVersion: null,
    updateHistory: [],
    downloading: false,
    progress: 0,
    hideModal: hide,
    downloadAndInstall: install,
  });
  useHotUpdate.mockReturnValue({
    hasUpdate: false,
    status: 'idle',
    bundleInfo: null,
    applyUpdate: jest.fn(),
  });
});
afterEach(async () => {
  await unmount();
  queryClient.clear();
});
test('mounts the shell, refreshes on native bill events and removes the listener on unmount', async () => {
  await mount();
  expect(JSON.stringify(root!.toJSON())).toContain('navigation-boundary');
  await act(async () => {
    DeviceEventEmitter.emit('onBillCreated');
  });
  expect(invalidateCache.bills).toHaveBeenCalledTimes(1);
  await unmount();
  DeviceEventEmitter.emit('onBillCreated');
  expect(invalidateCache.bills).toHaveBeenCalledTimes(1);
  await mount();
  await act(async () => {
    DeviceEventEmitter.emit('onBillCreated');
  });
  expect(invalidateCache.bills).toHaveBeenCalledTimes(2);
});
test('restores the auto-update setting and reacts to changes', async () => {
  await AsyncStorage.setItem(
    'appGeneralConfig',
    JSON.stringify({ autoUpdateEnabled: false }),
  );
  await mount();
  expect(useHotUpdate).toHaveBeenLastCalledWith({ autoCheck: false });
  await act(async () => {
    DeviceEventEmitter.emit('autoUpdateSettingChanged', true);
  });
  expect(useHotUpdate).toHaveBeenLastCalledWith({ autoCheck: true });
});
test('consumes the pending update notice once across remounts', async () => {
  await AsyncStorage.setItem(
    'pendingAutoUpdateNotice',
    JSON.stringify({ version: 7, updateLog: '新的更新说明' }),
  );
  await mount();
  expect(alert).toHaveBeenCalledWith('自动更新完成', '新的更新说明');
  expect(await AsyncStorage.getItem('pendingAutoUpdateNotice')).toBeNull();
  await unmount();
  await mount();
  expect(alert).toHaveBeenCalledTimes(1);
});
test('malformed notice does not prevent startup or show false completion', async () => {
  await AsyncStorage.setItem('pendingAutoUpdateNotice', '{broken');
  await mount();
  expect(JSON.stringify(root!.toJSON())).toContain('navigation-boundary');
  expect(alert).not.toHaveBeenCalled();
});
test('passes progress and explicit confirm/cancel actions to the update dialog', async () => {
  const version = { version: 'test-release' };
  useAppUpdate.mockReturnValue({
    showModal: true,
    latestVersion: version,
    updateHistory: [],
    downloading: true,
    progress: 42,
    hideModal: hide,
    downloadAndInstall: install,
  });
  await mount();
  const modal = root!.root.findByType(UpdateModal);
  expect(modal.props).toMatchObject({
    visible: true,
    versionInfo: version,
    downloading: true,
    progress: 42,
  });
  modal.props.onConfirm();
  modal.props.onCancel();
  expect(install).toHaveBeenCalledTimes(1);
  expect(hide).toHaveBeenCalledTimes(1);
});
