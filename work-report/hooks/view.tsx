// Drawing. Pure functions from a Report to an element tree. Nothing here reads or writes state.
// Every color, size and space comes from tokens.ts. Every row is built to fit the pane width,
// so nothing wraps: text is cut or padded to exact cell counts before it is drawn.

import type { Elements } from 'claude-code'

import type { TabId } from '../types'
import { bigRows, bigWidth } from './bigdigits'
import { TABS, formatCount, formatHours, formatMoney } from './logic'
import type { Bar, Report } from './logic'
import { CHART_PALETTE, COLOR, GLYPH, KIND_COLOR, MODEL_PALETTE, SIZE, SPACE } from './tokens'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Cuts the text to the width, ending in an ellipsis when it was cut. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return text.slice(0, width - 1) + GLYPH.ellipsis
}

export function padEnd(text: string, width: number): string {
  const cut = fit(text, width)
  return cut + ' '.repeat(Math.max(0, width - cut.length))
}

export function padStart(text: string, width: number): string {
  const cut = fit(text, width)
  return ' '.repeat(Math.max(0, width - cut.length)) + cut
}

/** Breaks text into lines that each fit the width. A word longer than the width is cut. */
export function wrapWords(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(part => part.length > 0)) {
    const piece = fit(word, width)
    if (line.length === 0) {
      line = piece
    } else if (line.length + 1 + piece.length <= width) {
      line = `${line} ${piece}`
    } else {
      lines.push(line)
      line = piece
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/** The width the report draws at, from the cells the surface gave the body. */
export function paneWidth(cells: number | undefined): number {
  const wanted = cells !== undefined && cells > 0 ? cells : SIZE.defaultWidth
  return Math.max(SIZE.minWidth, Math.min(SIZE.maxWidth, wanted))
}

/** Tiles in one row: three when wide, two when narrower, one when very narrow. */
export function tilesPerRow(cols: number): number {
  if (cols >= SIZE.threeTilesAt) return 3
  if (cols >= SIZE.twoTilesAt) return 2
  return 1
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function heading(ui: Ui, cols: number, text: string, key: string) {
  const { Box, Text } = ui
  const label = fit(text.toUpperCase(), cols)
  const rest = Math.max(0, cols - label.length - SPACE.headingGap)
  return (
    <Box key={key} flexDirection="row" width={cols}>
      <Text bold color={COLOR.textMain}>
        {label}
      </Text>
      <Text color={COLOR.hairline}>
        {' '.repeat(rest > 0 ? SPACE.headingGap : 0) + GLYPH.hairline.repeat(rest)}
      </Text>
    </Box>
  )
}

/** A horizontal bar of exact width: filled to the fraction, the rest a solid track. */
function bar(ui: Ui, fraction: number, width: number, color: string, key: string) {
  const { Box, Text } = ui
  if (width <= 0) return null
  let eighths = Math.round(fraction * width * SIZE.chartLevels)
  if (fraction > 0 && eighths === 0) eighths = 1
  eighths = Math.min(eighths, width * SIZE.chartLevels)
  const full = Math.floor(eighths / SIZE.chartLevels)
  const part = eighths % SIZE.chartLevels
  const rest = width - full - (part > 0 ? 1 : 0)
  return (
    <Box key={key} flexDirection="row" width={width}>
      {full > 0 ? <Text color={color}>{GLYPH.fill.repeat(full)}</Text> : null}
      {part > 0 ? (
        <Text color={color} backgroundColor={COLOR.track}>
          {GLYPH.partial[part - 1] ?? ''}
        </Text>
      ) : null}
      {rest > 0 ? <Text backgroundColor={COLOR.track}>{' '.repeat(rest)}</Text> : null}
    </Box>
  )
}

function rowLayout(cols: number, withHours: boolean) {
  const hoursWidth = withHours ? SIZE.hoursWidth : 0
  const gaps = withHours ? 3 : 2
  const fixed = SIZE.countWidth + hoursWidth + gaps
  let nameWidth: number = SIZE.nameMax
  if (cols - nameWidth - fixed < SIZE.barMin) {
    nameWidth = Math.max(SIZE.nameMin, cols - fixed - SIZE.barMin)
  }
  const barWidth = Math.max(0, cols - nameWidth - fixed)
  return { nameWidth, barWidth, hoursWidth }
}

function tab(ui: Ui, cols: number, report: Report, onTab: (tab: TabId) => void) {
  const { Box, Text, Button } = ui
  const pad = cols >= SIZE.tabPadAt ? ' '.repeat(SPACE.tabPad) : ''
  return (
    <Box key="tabs" flexDirection="row" gap={SPACE.tabGap} width={cols}>
      {TABS.map(item => {
        const isChosen = item.id === report.tab
        return (
          <Button key={`tab-${item.id}`} plain onPress={() => onTab(item.id)}>
            <Text
              bold={isChosen}
              color={isChosen ? COLOR.onGold : COLOR.onChip}
              backgroundColor={isChosen ? COLOR.gold : COLOR.chipIdle}
            >
              {pad + item.label + pad}
            </Text>
          </Button>
        )
      })}
    </Box>
  )
}

function titleBar(ui: Ui, cols: number, report: Report) {
  const { Box, Text } = ui
  const title = fit(report.title, cols)
  const dates = fit(report.dates, Math.max(0, cols - title.length - 1))
  const gap = Math.max(0, cols - title.length - dates.length)
  return (
    <Box key="title" flexDirection="column" width={cols}>
      <Box key="title-row" flexDirection="row" width={cols}>
        <Text bold color={COLOR.textMain}>
          {title}
        </Text>
        <Text color={COLOR.textMuted}>{' '.repeat(gap) + dates}</Text>
      </Box>
      <Box key="title-rule" flexDirection="row" width={cols}>
        <Text bold color={COLOR.gold}>
          {GLYPH.goldRule.repeat(title.length)}
        </Text>
        <Text color={COLOR.hairline}>{GLYPH.hairline.repeat(Math.max(0, cols - title.length))}</Text>
      </Box>
    </Box>
  )
}

function tile(
  ui: Ui,
  key: string,
  width: number,
  label: string,
  value: string,
  color: string,
  caption: string,
) {
  const { Box, Text } = ui
  const inner = width - SIZE.tileBorder - 2 * SPACE.tilePadX
  const rows = bigWidth(value) <= inner ? bigRows(value) : undefined
  return (
    <Box
      key={key}
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={color}
      paddingX={SPACE.tilePadX}
    >
      <Text bold color={color}>
        {fit(label, inner)}
      </Text>
      <Box key={`${key}-value`} flexDirection="column">
        {rows !== undefined ? (
          rows.map(line => (
            <Text bold color={color}>
              {line}
            </Text>
          ))
        ) : (
          [
            <Text>{' '}</Text>,
            <Text bold color={color}>
              {fit(value, inner)}
            </Text>,
            <Text>{' '}</Text>,
          ]
        )}
      </Box>
      <Text color={COLOR.textMuted}>{fit(caption, inner)}</Text>
    </Box>
  )
}

function tiles(ui: Ui, cols: number, report: Report) {
  const { Box } = ui
  const perRow = tilesPerRow(cols)
  const width = Math.floor((cols - SPACE.tileGap * (perRow - 1)) / perRow)
  const all = [
    tile(ui, 'tile-hours', width, 'HOURS SAVED', formatHours(report.estimate.hours), COLOR.tileHours, 'ESTIMATE'),
    tile(ui, 'tile-tasks', width, 'TASKS DONE', formatCount(report.totals.total), COLOR.tileTasks, 'FINISHED'),
    tile(
      ui,
      'tile-dollars',
      width,
      "DOLLARS' WORTH",
      `$${formatMoney(report.estimate.dollars)}`,
      COLOR.tileDollars,
      'ESTIMATE',
    ),
  ]
  const lines = []
  for (let first = 0; first < all.length; first += perRow) {
    lines.push(
      <Box key={`tile-row-${first / perRow}`} flexDirection="row" gap={SPACE.tileGap} width={cols}>
        {all.slice(first, first + perRow)}
      </Box>,
    )
  }
  return (
    <Box key="tiles" flexDirection="column" width={cols} marginTop={SPACE.sectionGap}>
      {lines}
    </Box>
  )
}

function kindRows(ui: Ui, cols: number, report: Report) {
  const { Box, Text } = ui
  const layout = rowLayout(cols, true)
  const top = Math.max(1, ...report.kindRows.map(row => row.count))
  return (
    <Box key="kinds" flexDirection="column" width={cols} marginTop={SPACE.sectionGap}>
      {heading(ui, cols, 'Where the time went', 'kinds-heading')}
      {report.kindRows.map(row => (
        <Box key={`kind-${row.id}`} flexDirection="row" width={cols} marginTop={SPACE.rowGap}>
          <Text bold color={KIND_COLOR[row.id]}>
            {padEnd(row.label, layout.nameWidth) + ' '}
          </Text>
          {bar(ui, row.count / top, layout.barWidth, KIND_COLOR[row.id], `kind-bar-${row.id}`)}
          <Text bold color={COLOR.textMain}>
            {' ' + padStart(String(row.count), SIZE.countWidth)}
          </Text>
          <Text color={COLOR.textMuted}>
            {' ' + padStart(`${formatHours(row.hours)}h`, layout.hoursWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

function modelRows(ui: Ui, cols: number, report: Report) {
  const { Box, Text } = ui
  const layout = rowLayout(cols, false)
  let rows = report.modelRows
  if (rows.length > SIZE.maxModelRows) {
    const shown = rows.slice(0, SIZE.maxModelRows - 1)
    const others = rows.slice(SIZE.maxModelRows - 1).reduce((sum, row) => sum + row.count, 0)
    rows = [...shown, { name: 'Others', count: others }]
  }
  const top = Math.max(1, ...rows.map(row => row.count))
  return (
    <Box key="models" flexDirection="column" width={cols} marginTop={SPACE.sectionGap}>
      {heading(ui, cols, 'Who did the work', 'models-heading')}
      {rows.map((row, index) => {
        const color = MODEL_PALETTE[index % MODEL_PALETTE.length] ?? COLOR.textMain
        return (
          <Box key={`model-${index}`} flexDirection="row" width={cols} marginTop={SPACE.rowGap}>
            <Text bold color={color}>
              {padEnd(row.name, layout.nameWidth) + ' '}
            </Text>
            {bar(ui, row.count / top, layout.barWidth, color, `model-bar-${index}`)}
            <Text bold color={COLOR.textMain}>
              {' ' + padStart(String(row.count), SIZE.countWidth)}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

function emptyState(ui: Ui, cols: number, report: Report) {
  const { Box, Text } = ui
  const lines = wrapWords(report.emptyText ?? '', cols)
  return (
    <Box key="empty-state" flexDirection="column" width={cols} marginTop={SPACE.sectionGap}>
      {lines.map((line, index) => (
        <Text color={COLOR.textMain}>
          {line}
        </Text>
      ))}
    </Box>
  )
}

/** Where each label of a bar chart goes: one string as wide as the chart. */
export function chartLabels(kind: Report['chartKind'], bars: readonly Bar[], slot: number): string {
  const total = slot * bars.length
  if (kind !== 'month') {
    return bars
      .map(item => {
        const text = kind === 'year' && slot < SIZE.yearWideLabelAt ? item.label.slice(0, 1) : item.label
        const cut = fit(text, slot)
        const left = Math.floor((slot - cut.length) / 2)
        return ' '.repeat(left) + cut + ' '.repeat(slot - left - cut.length)
      })
      .join('')
  }
  const cells: string[] = new Array(total).fill(' ')
  const step = Math.ceil((SIZE.monthLabelWidth + 1) / slot)
  for (let index = bars.length - 1; index >= 0; index -= step) {
    const label = bars[index]?.label ?? ''
    const start = (index + 1) * slot - label.length
    if (start < 0) continue
    for (let offset = 0; offset < label.length; offset += 1) cells[start + offset] = label.charAt(offset)
  }
  return cells.join('')
}

function chart(ui: Ui, cols: number, report: Report) {
  const { Box, Text } = ui
  const bars = report.bars.slice(-cols)
  const slot = Math.max(1, Math.floor(cols / bars.length))
  const barWidth = slot === 1 ? 1 : Math.min(SIZE.maxBarWidth, slot - 1)
  const lead = Math.floor((cols - slot * bars.length) / 2)
  const top = Math.max(1, ...bars.map(item => item.value))
  const levels = SIZE.chartRows * SIZE.chartLevels
  const left = Math.floor((slot - barWidth) / 2)
  const right = slot - barWidth - left

  const lines = []
  for (let row = 0; row < SIZE.chartRows; row += 1) {
    const cells = bars.map((item, index) => {
      const level = item.value > 0 ? Math.max(1, Math.round((item.value / top) * levels)) : 0
      const rise = Math.min(SIZE.chartLevels, Math.max(0, level - (SIZE.chartRows - 1 - row) * SIZE.chartLevels))
      const isBase = row === SIZE.chartRows - 1 && rise === 0 && !item.isFuture
      const glyph = rise > 0 ? (GLYPH.rise[rise - 1] ?? ' ') : isBase ? GLYPH.baseline : ' '
      const color = isBase
        ? COLOR.hairline
        : item.isHighlight
          ? COLOR.gold
          : (CHART_PALETTE[index % CHART_PALETTE.length] ?? COLOR.gold)
      return (
        <Text color={color}>
          {' '.repeat(left) + glyph.repeat(barWidth) + ' '.repeat(right)}
        </Text>
      )
    })
    lines.push(
      <Box key={`chart-row-${row}`} flexDirection="row" width={cols}>
        {lead > 0 ? (
          <Box key={`chart-lead-${row}`} flexDirection="row" width={lead}>
            <Text>{' '.repeat(lead)}</Text>
          </Box>
        ) : null}
        {cells}
      </Box>,
    )
  }
  const labels = chartLabels(report.chartKind, bars, slot)
  return (
    <Box key="chart" flexDirection="column" width={cols} marginTop={SPACE.sectionGap}>
      {heading(ui, cols, report.chartKind === 'year' ? 'Tasks by month' : 'Tasks by day', 'chart-heading')}
      {lines}
      <Box key="chart-labels" flexDirection="row" width={cols}>
        <Text color={COLOR.textMuted}>{' '.repeat(lead) + labels}</Text>
      </Box>
      <Box key="summary" flexDirection="row" width={cols}>
        <Text bold color={COLOR.textMain}>
          {fit(report.summary, cols)}
        </Text>
      </Box>
    </Box>
  )
}

function footer(ui: Ui, cols: number) {
  const { Box, Text } = ui
  const lines = wrapWords(
    'Hours and dollars are an ESTIMATE. Set minutes per task and your rate with /report settings.',
    cols,
  )
  return (
    <Box key="footer" flexDirection="column" width={cols} marginTop={SPACE.sectionGap}>
      {lines.map((line, index) => (
        <Text color={COLOR.textMuted}>
          {line}
        </Text>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The two trees
// ---------------------------------------------------------------------------

export function drawReport(
  ui: Ui,
  input: { report: Report; cells: number | undefined; onTab: (tab: TabId) => void },
) {
  const { Box } = ui
  const cols = paneWidth(input.cells)
  const { report } = input
  return (
    <Box key="work-report" flexDirection="column" width={cols}>
      {tab(ui, cols, report, input.onTab)}
      <Box key="title-wrap" flexDirection="column" width={cols} marginTop={SPACE.sectionGap}>
        {titleBar(ui, cols, report)}
      </Box>
      {tiles(ui, cols, report)}
      {report.emptyText !== undefined ? (
        emptyState(ui, cols, report)
      ) : (
        <Box key="sections" flexDirection="column" width={cols}>
          {kindRows(ui, cols, report)}
          {modelRows(ui, cols, report)}
        </Box>
      )}
      {chart(ui, cols, report)}
      {footer(ui, cols)}
    </Box>
  )
}

/** The one button that opens the pane: a gold chip with dark bold text. */
export function drawBand(ui: Ui, input: { cells: number | undefined; todayTotal: number; onOpen: () => void }) {
  const { Box, Text, Button } = ui
  const cols = paneWidth(input.cells)
  const chip = ' Work report '
  const note = fit(` ${input.todayTotal} finished today`, Math.max(0, cols - chip.length))
  return (
    <Box key="work-report-band" flexDirection="row" width={cols}>
      <Button key="open-report" plain onPress={input.onOpen}>
        <Text bold color={COLOR.onGold} backgroundColor={COLOR.gold}>
          {chip}
        </Text>
      </Button>
      <Text color={COLOR.textMuted}>{note}</Text>
    </Box>
  )
}
