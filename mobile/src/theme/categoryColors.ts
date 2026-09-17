// Category identity is independent of income/expense amount colors.
const palette = ['#D99A16', '#4385CF', '#D66C9E', '#9370CD', '#D98748', '#409F99'];
const accents: Record<string, string> = {
  餐饮: '#D99A16', 交通: '#4385CF', 购物: '#D66C9E', 娱乐: '#9370CD',
  医疗: '#D97070', 教育: '#D98748', 居住: '#409F99', 工资: '#D99A16',
  奖金: '#D98748', 理财: '#409F99', 收入: '#409F99', 退款: '#4385CF',
};
export function categoryIconBackground(name?: string, customColor?: string): string {
  const key = name?.trim() || '未分类';
  if (key === '未分类' || key === '其他') return '#8993A324';
  let accent = customColor?.trim();
  if (accent && /^#[0-9a-f]{3}$/i.test(accent)) {
    accent = '#' + [...accent.slice(1)].map(c => c + c).join('');
  }
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) {
    const hash = [...key].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
    accent = accents[key] || palette[hash % palette.length];
  }
  return accent + '24';
}
