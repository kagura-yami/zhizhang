import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import BottomTabBar from '../src/navigation/BottomTabBar';
import { lightColors } from '../src/theme/colors';

test('社群关闭保留普通入口，开启后增加可点击的独立入口', () => {
  const press = jest.fn();
  let root!: Renderer.ReactTestRenderer;
  const render = (enabled: boolean) => <BottomTabBar activeTab="dashboard" colors={lightColors} communityEnabled={enabled} onTabPress={press} />;
  act(() => { root = Renderer.create(render(false)); });
  const labels = () => root.root.findAllByType(Text).map(n => n.props.children);
  for (const title of ['首页', '统计', '记账', 'AI助手', '我的']) expect(labels()).toContain(title);
  expect(labels()).not.toContain('社群');
  act(() => { root.update(render(true)); });
  expect(labels()).toContain('社群');
  const community = root.root.findAllByType(TouchableOpacity).find(n => n.findAllByType(Text).some(t => t.props.children === '社群'))!;
  act(() => { community.props.onPress(); });
  expect(press).toHaveBeenCalledWith('community');
  act(() => { root.update(render(false)); });
  expect(labels()).not.toContain('社群');
  expect(labels()).toContain('AI助手');
  act(() => root.unmount());
});
