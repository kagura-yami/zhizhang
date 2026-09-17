import React, { useState } from 'react';
import { View } from 'react-native';

interface Props<T> {
  items: readonly T[];
  columns: number;
  gap: number;
  itemKey: (item: T) => string;
  renderItem: (item: T, width: number) => React.ReactNode;
}

/** Explicit rows prevent fractional Android dp widths from wrapping a column. */
export default function FixedColumnGrid<T>({ items, columns, gap, itemKey, renderItem }: Props<T>) {
  const [width, setWidth] = useState(0);
  const cellWidth = Math.max(0, (width - gap * (columns - 1)) / columns);
  const rows = Array.from({ length: Math.ceil(items.length / columns) }, (_, index) =>
    items.slice(index * columns, (index + 1) * columns));

  return (
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ gap }}>
      {rows.map(row => (
        <View key={itemKey(row[0])} style={{ flexDirection: 'row', gap }}>
          {Array.from({ length: columns }, (_, index) => (
            <View key={index < row.length ? itemKey(row[index]) : `blank-${index}`} style={{ flex: 1, minWidth: 0 }}>
              {index < row.length ? renderItem(row[index], cellWidth) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
