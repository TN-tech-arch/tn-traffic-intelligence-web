/** High-contrast qualitative colors for comparing independent regions/models. */
export const COMPARISON_LINE_PALETTE = [
  '#0067C5',
  '#E85D04',
  '#0B8F6A',
  '#D7263D',
  '#7B2CBF',
  '#D4A017',
  '#008C95',
  '#E83E8C',
  '#6A994E',
  '#8C4A2F',
  '#5A67D8',
  '#475569',
]

export function comparisonLineColor(index: number): string {
  return COMPARISON_LINE_PALETTE[Math.abs(index) % COMPARISON_LINE_PALETTE.length]
}
