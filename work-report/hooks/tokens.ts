// The ONE tokens file. Every color, size and spacing value of the pane lives here.
// Components read only from these tokens. Change a value here and the pane follows.

import type { KindId } from '../types'

export const COLOR = {
  // Accent (chosen tab, main button, title rule). Dark bold text sits on it.
  gold: '#F2C46D',
  onGold: '#14141F',
  // Text on colored chips.
  onChip: '#F4F4FA',
  // Idle chip and bar track.
  chipIdle: '#3B3F63',
  track: '#2A2C40',
  // Body text follows the person's theme.
  textMain: 'text',
  textMuted: 'subtle',
  hairline: 'inactive',
  // Tiles.
  tileHours: '#3EE6C1',
  tileTasks: '#FF6B9D',
  tileDollars: '#8BE04E',
} as const

// One bright color per kind.
export const KIND_COLOR: Record<KindId, string> = {
  emails: '#FF6B9D',
  images: '#A66BFF',
  documents: '#3EA6FF',
  research: '#2EE6A6',
  other: '#FF8A3D',
}

// Chart bars cycle through these. The highlighted bar uses COLOR.gold.
export const CHART_PALETTE = [
  '#FF6B9D',
  '#FF8A3D',
  '#FFD23F',
  '#2EE6A6',
  '#3EA6FF',
  '#A66BFF',
  '#FF5D5D',
] as const

// Model bars cycle through these.
export const MODEL_PALETTE = [
  '#3EA6FF',
  '#FF6B9D',
  '#2EE6A6',
  '#A66BFF',
  '#FF8A3D',
  '#FFD23F',
] as const

// Sizes, in terminal cells (columns and rows) unless the name says otherwise.
export const SIZE = {
  defaultWidth: 80,
  minWidth: 24,
  maxWidth: 120,
  // Tiles per row: three at this width or more, two at the next, else one.
  threeTilesAt: 66,
  twoTilesAt: 44,
  // Below this width the tab chips lose their side padding.
  tabPadAt: 32,
  nameMax: 16,
  nameMin: 7,
  countWidth: 5,
  hoursWidth: 7,
  barMin: 6,
  maxModelRows: 6,
  maxBarWidth: 7,
  chartRows: 3,
  chartLevels: 8,
  monthLabelWidth: 2,
  yearWideLabelAt: 4,
  bigDigitRows: 3,
  bigGap: 1,
  tileBorder: 2,
  maxStaleMs: 120000,
  loadDays: 400,
  bandMinWidth: 20,
} as const

export const SPACE = {
  tabGap: 1,
  tabPad: 1,
  tileGap: 1,
  tilePadX: 1,
  sectionGap: 1,
  rowGap: 0,
  headingGap: 1,
} as const

export const GLYPH = {
  goldRule: '━',
  hairline: '─',
  fill: '█',
  // Partial blocks, one eighth to seven eighths of a cell.
  partial: ['▏', '▎', '▍', '▌', '▋', '▊', '▉'],
  // Chart blocks, one eighth to a full cell.
  rise: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  baseline: '▁',
  ellipsis: '…',
  bullet: '-',
} as const
