/**
 * 统一间距、圆角与轻量阴影
 * 暖色底、细边框、白色圆角表面
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 48,
} as const;

export const borderRadius = {
  none: 0,
  small: 8,
  medium: 12,
  large: 16,
  xlarge: 20,
  round: 50,
  card: 20,       // 统一卡片圆角
  button: 12,
  input: 12,
} as const;

// 控件和卡片使用细边框
export const borderWidth = {
  thin: 1,
  medium: 1,
  thick: 1.5,
} as const;

// 保持轻量层级；交互动画单独管理
export const shadow = {
  small: {
    shadowColor: '#1A1A1A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  medium: {
    shadowColor: '#1A1A1A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  large: {
    shadowColor: '#1A1A1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
} as const;

export type SpacingKey = keyof typeof spacing;
export type BorderRadiusKey = keyof typeof borderRadius;
