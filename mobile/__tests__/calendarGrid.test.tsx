import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { View } from 'react-native';
import CalendarGrid from '../src/components/reports/CalendarGrid';
import FixedColumnGrid from '../src/components/reports/FixedColumnGrid';
import GridCell from '../src/components/reports/GridCell';

jest.mock('../src/hooks', () => ({
  useStyles: (factory: any) => factory(require('../src/theme/colors').lightColors),
}));
jest.mock('../src/services/api/ledger', () => ({
  currentBusinessDate: () => ({ key: '2026-09-17' }),
}));

test.each([[2026, 8], [2024, 1], [2026, 1], [2026, 2]])(
  '%i/%i: each date stays in its weekday column, including leap days and six-week months',
  (year, month) => {
    const press = jest.fn();
    let tree!: Renderer.ReactTestRenderer;
    act(() => { tree = Renderer.create(<CalendarGrid year={year} month={month} dailyData={new Map()} selectedDay={null} onDayPress={press} />); });
    const grid = tree.root.findByType(FixedColumnGrid);
    const container = grid.findAllByType(View).find(node => node.props.onLayout)!;
    for (const width of [287.625, 360.625, 735.625]) {
      act(() => container.props.onLayout({ nativeEvent: { layout: { width } } }));
      const rows = container.findAllByType(View).filter(node => node.props.style?.flexDirection === 'row');
      const dates: number[] = [];
      for (const row of rows) {
        const slots = row.findAllByType(View).filter(node => node.props.style?.flex === 1);
        expect(slots).toHaveLength(7);
        slots.forEach((slot, column) => {
          const cell = (slot as Renderer.ReactTestInstance).findAllByType((GridCell as any).type)[0];
          if (!cell) return;
          const day = Number(cell.props.label);
          dates.push(day);
          expect(column).toBe((new Date(year, month, day).getDay() + 6) % 7);
          expect(cell.props.width * 7 + 18).toBeCloseTo(width);
        });
      }
      expect(dates).toEqual(Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1));
    }
    act(() => grid.findAllByType((GridCell as any).type)[0].props.onPress());
    expect(press).toHaveBeenCalledWith(`${year}-${String(month + 1).padStart(2, '0')}-01`);
    act(() => tree.unmount());
  },
);
