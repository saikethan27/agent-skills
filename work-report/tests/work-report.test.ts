import { describe, expect, mock, test } from 'claude-code/testing'

import {
  EMPTY_TODAY,
  addDays,
  addTaskToDay,
  buildReport,
  changeSetting,
  chartBars,
  classifyTask,
  classifyTool,
  dateKey,
  dayOfYear,
  emptyDay,
  isTypedPrompt,
  keysBetween,
  modelLabel,
  readSettings,
  streak,
  stretchFor,
  sumDays,
} from '../hooks/logic'
import { bigRows, bigWidth } from '../hooks/bigdigits'
import { chartLabels, fit, tilesPerRow, wrapWords } from '../hooks/view'
import type { DayRecord } from '../types'

// A fixed "now": 13 October 2026, mid-afternoon, local time.
const NOW = new Date(2026, 9, 13, 15, 0, 0, 0).getTime()
const TODAY = dateKey(NOW)

// The store beneath the plugin, in memory. The test keeps the map so it can look inside.
function memoryStore(on: any, entries: Record<string, unknown> = {}): Map<string, unknown> {
  const data = new Map<string, unknown>(Object.entries(entries))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: data.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    data.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...data.keys()] }))
  return data
}

function day(counts: Partial<DayRecord['kinds']>, models: Record<string, number> = {}): DayRecord {
  const record = emptyDay()
  Object.assign(record.kinds, counts)
  record.models = models
  return record
}

// ---------------------------------------------------------------------------
// 1. Sorting a task into a kind by its tools
// ---------------------------------------------------------------------------

describe('sorting a task into a kind', () => {
  test('mail tools make Emails', () => {
    expect(classifyTask([{ name: 'mcp__claude_ai_Gmail__create_draft' }])).toBe('emails')
    expect(classifyTask([{ name: 'mcp__x__send_email' }])).toBe('emails')
    expect(classifyTask([{ name: 'mcp__outlook__list' }])).toBe('emails')
  })

  test('image and video tools or files make Images and video', () => {
    expect(classifyTask([{ name: 'mcp__flow__flow_generate' }])).toBe('images')
    expect(classifyTask([{ name: 'mcp__x__generate_image' }])).toBe('images')
    expect(classifyTask([{ name: 'Write', path: 'G:/site/hero.png' }])).toBe('images')
    expect(classifyTask([{ name: 'Write', path: 'clip.mp4' }])).toBe('images')
  })

  test('document, slide and sheet tools or files make Documents', () => {
    expect(classifyTask([{ name: 'Write', path: 'report.docx' }])).toBe('documents')
    expect(classifyTask([{ name: 'Write', path: 'notes.md' }])).toBe('documents')
    expect(classifyTask([{ name: 'mcp__x__create_pptx' }])).toBe('documents')
    expect(classifyTask([{ name: 'mcp__x__xlsx_write' }])).toBe('documents')
    expect(classifyTask([{ name: 'Artifact' }])).toBe('documents')
  })

  test('web search, page reading and transcripts make Research', () => {
    expect(classifyTask([{ name: 'WebSearch' }])).toBe('research')
    expect(classifyTask([{ name: 'WebFetch' }])).toBe('research')
    expect(classifyTask([{ name: 'mcp__x__get_transcript' }])).toBe('research')
    expect(classifyTask([{ name: 'mcp__claude-in-chrome__get_page_text' }])).toBe('research')
    expect(classifyTool('mcp__Context7__query-docs')).toBe('research')
  })

  test('everything else is Other', () => {
    expect(classifyTask([])).toBe('other')
    expect(classifyTask([{ name: 'Bash' }, { name: 'Read' }, { name: 'Grep' }])).toBe('other')
    expect(classifyTask([{ name: 'Edit', path: 'src/app.ts' }])).toBe('other')
  })

  test('a task with several kinds gets exactly one', () => {
    expect(classifyTask([{ name: 'WebSearch' }, { name: 'mcp__x__send_email' }])).toBe('emails')
    expect(classifyTask([{ name: 'WebSearch' }, { name: 'Write', path: 'a.docx' }])).toBe('documents')
    expect(classifyTask([{ name: 'Write', path: 'a.docx' }, { name: 'Write', path: 'a.png' }])).toBe('images')
  })

  test('model names are made short and stable', () => {
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
    expect(modelLabel(undefined)).toBe('Unknown')
  })
})

// ---------------------------------------------------------------------------
// 2. Counting only typed prompts
// ---------------------------------------------------------------------------

describe('counting only typed prompts', () => {
  test('the rule', () => {
    expect(isTypedPrompt({ kind: 'composer' }, 'write a summary')).toBe(true)
    expect(isTypedPrompt({ kind: 'composer' }, '/report')).toBe(false)
    expect(isTypedPrompt({ kind: 'composer' }, '   ')).toBe(false)
    expect(isTypedPrompt({ kind: 'task-notification' }, 'done')).toBe(false)
    expect(isTypedPrompt({ kind: 'scheduled-trigger' }, 'run')).toBe(false)
    expect(isTypedPrompt({ kind: 'peer' }, 'hi')).toBe(false)
    expect(isTypedPrompt({ kind: 'plugin' }, 'hi')).toBe(false)
  })

  // Runs one turn through the engine, with the plugin hooks above the test's bottoms.
  async function run(
    scenario: (go: (input: {
      text: string
      origin?: { kind: string }
      tools?: string[]
      reason?: 'answer' | 'aborted'
      agentId?: string
      withPrompt?: boolean
      model?: string
    }) => Promise<void>) => Promise<void>,
    $: any,
    on: any,
  ) {
    mock.clock(on, { now: NOW })
    const store = memoryStore(on)
    on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
    on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: 'ok' }))
    on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
    let counter = 0
    await scenario(async input => {
      counter += 1
      const turnId = `turn-${counter}`
      if (input.withPrompt !== false) {
        await $.prompt.submit({
          text: input.text,
          origin: input.origin ?? { kind: 'composer' },
          wait: false,
        })
      }
      await $.turn.start({ text: input.text, turnId })
      for (const [index, tool] of (input.tools ?? []).entries()) {
        await $.tool.call({ tool, tool_use_id: `${turnId}-${index}`, agentId: input.agentId })
      }
      await $.turn.complete({
        answer: 'done',
        durationMs: 10,
        isAborted: input.reason === 'aborted',
        turnId,
        reason: input.reason ?? 'answer',
        agentId: input.agentId,
        usage: {
          model: input.model ?? 'claude-sonnet-5-5',
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      })
    })
    return store
  }

  function saved(store: Map<string, unknown>): DayRecord | undefined {
    return store.get(`day:${TODAY}`) as DayRecord | undefined
  }

  test('one typed request is one task, however many tool steps it used', async ($, on) => {
    const store = await run(
      async go => {
        await go({ text: 'research the market and mail it', tools: ['WebSearch', 'WebFetch', 'Bash', 'Read'] })
      },
      $,
      on,
    )
    const record = saved(store)
    expect(record?.kinds.research).toBe(1)
    expect(Object.values(record?.kinds ?? {}).reduce((sum, value) => sum + value, 0)).toBe(1)
    expect(record?.models['Sonnet 5.5']).toBe(1)
  })

  test('helper agent turns, cancelled turns, slash commands and notifications are not counted', async ($, on) => {
    const store = await run(
      async go => {
        // A helper agent runs a turn of its own: no typed prompt came first.
        await go({ text: 'helper', withPrompt: false, agentId: 'agent-1', tools: ['WebSearch'] })
        // A cancelled turn.
        await go({ text: 'write a plan', reason: 'aborted' })
        // A slash command.
        await go({ text: '/report week' })
        // A background notification.
        await go({ text: 'build finished', origin: { kind: 'task-notification' } })
        // A scheduled trigger.
        await go({ text: 'nightly', origin: { kind: 'scheduled-trigger' } })
      },
      $,
      on,
    )
    expect(saved(store)).toBeUndefined()
    expect(store.size).toBe(0)
  })

  test('each typed request that is answered adds one, and the model is kept', async ($, on) => {
    const store = await run(
      async go => {
        await go({ text: 'one', tools: ['Bash'] })
        await go({ text: 'two', tools: ['mcp__x__send_email'], model: 'claude-opus-4-1-20250805' })
        await go({ text: 'three', tools: ['Write'] })
      },
      $,
      on,
    )
    const record = saved(store)
    expect(record?.kinds.other).toBe(2)
    expect(record?.kinds.emails).toBe(1)
    expect(record?.models['Sonnet 5.5']).toBe(2)
    expect(record?.models['Opus 4.1']).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3. The streak
// ---------------------------------------------------------------------------

describe('streak', () => {
  const one = day({ other: 1 })

  test('counts days in a row up to today', () => {
    const days = { [TODAY]: one, [addDays(TODAY, -1)]: one, [addDays(TODAY, -2)]: one, [addDays(TODAY, -4)]: one }
    expect(streak(days, TODAY)).toBe(3)
  })

  test('a quiet today does not break it', () => {
    const days = { [addDays(TODAY, -1)]: one, [addDays(TODAY, -2)]: one }
    expect(streak(days, TODAY)).toBe(2)
  })

  test('a gap yesterday and today means zero', () => {
    expect(streak({ [addDays(TODAY, -2)]: one }, TODAY)).toBe(0)
    expect(streak({}, TODAY)).toBe(0)
  })

  test('a streak crosses a month and a clock change', () => {
    const days: Record<string, DayRecord> = {}
    for (const key of keysBetween('2026-03-01', '2026-04-05')) days[key] = one
    expect(streak(days, '2026-04-05')).toBe(36)
  })
})

// ---------------------------------------------------------------------------
// 4. Adding days together
// ---------------------------------------------------------------------------

describe('adding days together', () => {
  test('totals for a stretch', () => {
    const total = sumDays([
      day({ emails: 2, other: 1 }, { 'Sonnet 5.5': 3 }),
      undefined,
      day({ emails: 1, research: 4 }, { 'Sonnet 5.5': 2, 'Opus 4.1': 3 }),
    ])
    expect(total.total).toBe(8)
    expect(total.kinds.emails).toBe(3)
    expect(total.kinds.research).toBe(4)
    expect(total.kinds.other).toBe(1)
    expect(total.models['Sonnet 5.5']).toBe(5)
    expect(total.models['Opus 4.1']).toBe(3)
  })

  test('adding a task makes a new record and leaves the old one alone', () => {
    const before = day({ other: 1 }, { A: 1 })
    const after = addTaskToDay(before, 'emails', 'A')
    expect(after.kinds.emails).toBe(1)
    expect(after.models.A).toBe(2)
    expect(before.kinds.emails).toBe(0)
  })

  test('the estimate uses the minutes and the rate', () => {
    const days = { [TODAY]: day({ emails: 3, documents: 1 }) }
    const report = buildReport('today', days, readSettings(undefined), TODAY)
    // 3 x 10 + 1 x 30 = 60 minutes = 1 hour = 50 dollars.
    expect(report.estimate.minutes).toBe(60)
    expect(report.estimate.hours).toBe(1)
    expect(report.estimate.dollars).toBe(50)
  })

  test('week and month cover 7 and 30 days; year runs from January 1', () => {
    expect(stretchFor('today', TODAY).keys).toHaveLength(1)
    expect(stretchFor('week', TODAY).keys).toHaveLength(7)
    expect(stretchFor('month', TODAY).keys).toHaveLength(30)
    expect(stretchFor('year', TODAY).first).toBe('2026-01-01')
  })

  test('settings change one value at a time and refuse bad ones', () => {
    const start = readSettings(undefined)
    expect(changeSetting(start, 'rate', '75').settings.rate).toBe(75)
    expect(changeSetting(start, 'emails', '15').settings.minutes.emails).toBe(15)
    expect(changeSetting(start, 'images', '25').settings.minutes.images).toBe(25)
    expect(changeSetting(start, 'rate', 'abc').settings).toBe(start)
    expect(changeSetting(start, 'colors', '5').settings).toBe(start)
  })
})

// ---------------------------------------------------------------------------
// 5. Day of the year, and stepping through days at local noon
// ---------------------------------------------------------------------------

describe('day of the year', () => {
  test('known days', () => {
    expect(dayOfYear('2026-01-01')).toBe(1)
    expect(dayOfYear('2026-10-13')).toBe(286)
    expect(dayOfYear('2026-12-31')).toBe(365)
    expect(dayOfYear('2024-03-01')).toBe(61)
    expect(dayOfYear('2024-12-31')).toBe(366)
  })

  test('the Year tab covers exactly that many days', () => {
    expect(stretchFor('year', TODAY).keys).toHaveLength(dayOfYear(TODAY))
    expect(stretchFor('year', '2024-12-31').keys).toHaveLength(366)
  })

  test('stepping across clock changes never skips or repeats a day', () => {
    for (const [first, last] of [
      ['2026-03-01', '2026-04-10'],
      ['2026-10-15', '2026-11-10'],
      ['2026-12-20', '2027-01-10'],
    ] as const) {
      const keys = keysBetween(first, last)
      expect(new Set(keys).size).toBe(keys.length)
      for (let index = 1; index < keys.length; index += 1) {
        expect(addDays(keys[index - 1] ?? '', 1)).toBe(keys[index])
      }
    }
    expect(addDays('2026-03-01', 30)).toBe('2026-03-31')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

// ---------------------------------------------------------------------------
// Drawing: shared helpers
// ---------------------------------------------------------------------------

type Node = string | { type: string; props?: Record<string, unknown>; children?: unknown[] } | null | undefined

function kids(node: Node): Node[] {
  if (typeof node !== 'object' || node === null) return []
  return (node.children ?? []).flat(Infinity as 1) as Node[]
}

function allText(node: Node): string {
  if (typeof node === 'string') return node
  return kids(node).map(allText).join('')
}

function findKey(node: Node, key: string): Node {
  if (typeof node !== 'object' || node === null) return undefined
  if (node.props?.key === key) return node
  for (const child of kids(node)) {
    const found = findKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

function findAllKeys(node: Node, prefix: string, out: Node[] = []): Node[] {
  if (typeof node !== 'object' || node === null) return out
  if (typeof node.props?.key === 'string' && node.props.key.startsWith(prefix)) out.push(node)
  for (const child of kids(node)) findAllKeys(child, prefix, out)
  return out
}

/** Collects every place a row is wider than the room it was given. */
function overflows(node: Node, room: number, found: string[] = []): string[] {
  const natural = (item: Node): number => {
    if (typeof item === 'string') return item.length
    if (typeof item !== 'object' || item === null) return 0
    const props = item.props ?? {}
    const children = kids(item)
    if (item.type === 'Text' || item.type === 'Button') return children.reduce<number>((sum, child) => sum + natural(child), 0)
    const isRow = props.flexDirection === 'row'
    const gap = typeof props.gap === 'number' ? props.gap : 0
    const frame = (props.borderStyle ? 2 : 0) + (typeof props.paddingX === 'number' ? props.paddingX * 2 : 0)
    const inner = isRow
      ? children.reduce<number>((sum, child) => sum + natural(child), 0) + gap * Math.max(0, children.length - 1)
      : children.reduce<number>((most, child) => Math.max(most, natural(child)), 0)
    const own = inner + frame
    if (typeof props.width === 'number') {
      if (own > props.width) found.push(`${String(props.key)}: needs ${own}, has ${props.width}`)
      return props.width
    }
    return own
  }
  const total = natural(node)
  if (total > room) found.push(`root: needs ${total}, has ${room}`)
  return found
}

const PANE_PROPS = (columns: number) => ({
  title: 'Work Report',
  isFocused: false,
  bodyColumns: columns,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

async function setup($: any, on: any, entries: Record<string, unknown> = {}) {
  mock.clock(on, { now: NOW })
  const store = memoryStore(on, entries)
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  return store
}

async function mountPane($: any, columns: number) {
  return $.ui.mount({
    plugin: 'work-report',
    surface: 'terminal',
    component: 'Pane',
    props: PANE_PROPS(columns),
    requestId: 'work-report',
    viewport: { columns, rows: 50 },
  })
}

function seed(): Record<string, unknown> {
  const entries: Record<string, unknown> = {}
  entries[`day:${TODAY}`] = day({ emails: 2, documents: 1 }, { 'Sonnet 5.5': 3 })
  entries[`day:${addDays(TODAY, -1)}`] = day({ research: 3 }, { 'Opus 4.1': 3 })
  entries[`day:${addDays(TODAY, -3)}`] = day({ images: 2, other: 4 }, { 'Sonnet 5.5': 6 })
  entries[`day:${addDays(TODAY, -20)}`] = day({ other: 9 }, { 'Haiku 3.5': 9 })
  entries[`day:2026-02-10`] = day({ documents: 5 }, { 'Sonnet 5.5': 5 })
  entries[`day:2026-02-11`] = day({ documents: 1 }, { 'Sonnet 5.5': 1 })
  return entries
}

// ---------------------------------------------------------------------------
// 6. Each tab draws its own title and chart
// ---------------------------------------------------------------------------

describe('the tabs', () => {
  const EXPECT = [
    { tab: 'today', title: 'TODAY', bars: 7, labels: 'Tue' },
    { tab: 'week', title: 'LAST 7 DAYS', bars: 7, labels: 'Mon' },
    { tab: 'month', title: 'LAST 30 DAYS', bars: 30, labels: '13' },
    { tab: 'year', title: 'YEAR 2026', bars: 12, labels: 'Jan' },
  ] as const

  test('each tab has its own title and its own three-row chart', async ($, on) => {
    await setup($, on, seed())
    const ui = await mountPane($, 100)
    for (const item of EXPECT) {
      await ui.press({ key: `tab-${item.tab}` })
      const tree = (await ui.drawn()) as Node
      expect(allText(findKey(tree, 'title-row'))).toContain(item.title)
      const rows = findAllKeys(tree, 'chart-row-')
      expect(rows).toHaveLength(3)
      // One Text per bar in each chart row (a keyed pad Box may come first).
      const barTexts = kids(rows[0]).filter(child => typeof child === 'object' && child?.type === 'Text')
      expect(barTexts).toHaveLength(item.bars)
      expect(allText(findKey(tree, 'chart-labels'))).toContain(item.labels)
    }
    await ui.unmount()
  })

  test('the chosen tab is gold with dark text; the others are not', async ($, on) => {
    await setup($, on, seed())
    const ui = await mountPane($, 100)
    await ui.press({ key: 'tab-week' })
    const tree = (await ui.drawn()) as Node
    const chosen = findKey(tree, 'tab-week')
    const other = findKey(tree, 'tab-year')
    const chosenText = kids(chosen)[0] as { props: Record<string, unknown> }
    const otherText = kids(other)[0] as { props: Record<string, unknown> }
    expect(chosenText.props.backgroundColor).toBe('#F2C46D')
    expect(chosenText.props.bold).toBe(true)
    expect(otherText.props.backgroundColor).not.toBe('#F2C46D')
    await ui.unmount()
  })

  test('the year chart marks the current month and leaves future months empty', () => {
    const bars = chartBars('year', { [TODAY]: day({ other: 4 }), '2026-02-10': day({ other: 2 }) }, TODAY)
    expect(bars).toHaveLength(12)
    expect(bars[9]?.isHighlight).toBe(true)
    expect(bars[9]?.value).toBe(4)
    expect(bars[1]?.value).toBe(2)
    expect(bars[10]?.isFuture).toBe(true)
    expect(bars[11]?.value).toBe(0)
  })

  test('summary lines: streak, best day, best month', () => {
    const entries = Object.fromEntries(Object.entries(seed()).map(([key, value]) => [key.slice(4), value as DayRecord]))
    const week = buildReport('week', entries, readSettings(undefined), TODAY)
    expect(week.summary).toContain('Streak: 2 days in a row')
    const month = buildReport('month', entries, readSettings(undefined), TODAY)
    expect(month.summary).toContain('Best day:')
    expect(month.summary).toContain('4 active days')
    const year = buildReport('year', entries, readSettings(undefined), TODAY)
    expect(year.summary).toContain('Best month:')
  })
})

// ---------------------------------------------------------------------------
// 7. The empty state
// ---------------------------------------------------------------------------

describe('empty state', () => {
  test('shows the exact text when nothing finished today', async ($, on) => {
    await setup($, on)
    const ui = await mountPane($, 120)
    const tree = (await ui.drawn()) as Node
    expect(allText(findKey(tree, 'empty-state'))).toBe(EMPTY_TODAY)
    expect(EMPTY_TODAY).toBe('Nothing finished yet today. Your first finished task shows up here.')
    await ui.unmount()
  })

  test('is not shown once a task is done today', async ($, on) => {
    await setup($, on, seed())
    const ui = await mountPane($, 120)
    const tree = (await ui.drawn()) as Node
    expect(findKey(tree, 'empty-state')).toBeUndefined()
    expect(findKey(tree, 'kinds')).toBeDefined()
    expect(findKey(tree, 'models')).toBeDefined()
    await ui.unmount()
  })

  test('narrow panes split the sentence into rows instead of wrapping', async ($, on) => {
    await setup($, on)
    const ui = await mountPane($, 30)
    const tree = (await ui.drawn()) as Node
    const empty = findKey(tree, 'empty-state')
    const lines = kids(empty).map(allText)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toBe(EMPTY_TODAY)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30)
    await ui.unmount()
  })
})

// ---------------------------------------------------------------------------
// 8. Narrow width: fewer tiles, no wrapping
// ---------------------------------------------------------------------------

describe('widths', () => {
  test('three tiles when wide, two when narrower, one when very narrow', () => {
    expect(tilesPerRow(120)).toBe(3)
    expect(tilesPerRow(80)).toBe(3)
    expect(tilesPerRow(60)).toBe(2)
    expect(tilesPerRow(44)).toBe(2)
    expect(tilesPerRow(43)).toBe(1)
    expect(tilesPerRow(24)).toBe(1)
  })

  for (const [columns, perRow] of [
    [110, 3],
    [60, 2],
    [32, 1],
  ] as const) {
    test(`at ${columns} columns: ${perRow} tile(s) in the first row, and no row overflows`, async ($, on) => {
      await setup($, on, seed())
      const ui = await mountPane($, columns)
      for (const tab of ['today', 'week', 'month', 'year']) {
        await ui.press({ key: `tab-${tab}` })
        const tree = (await ui.drawn()) as Node
        const rows = kids(findKey(tree, 'tiles'))
        expect(kids(rows[0])).toHaveLength(Math.min(3, perRow))
        expect(rows).toHaveLength(Math.ceil(3 / perRow))
        expect(overflows(tree, columns)).toEqual([])
      }
      await ui.unmount()
    })
  }

  test('the empty pane fits at a narrow and a wide width', async ($, on) => {
    await setup($, on)
    for (const columns of [24, 120]) {
      const ui = await mountPane($, columns)
      const tree = (await ui.drawn()) as Node
      expect(overflows(tree, columns)).toEqual([])
      await ui.unmount()
    }
  })

  test('big numerals are three rows of heavy box characters', async ($, on) => {
    expect(bigRows('1234')?.length).toBe(3)
    expect(bigWidth('12')).toBe(7)
    for (const row of bigRows('$1,250.5') ?? []) expect(row).toMatch(/^[ ┏┓┗┛┃━┣┫┻┳╋╺╸╻╹■,]+$/)
    await setup($, on, seed())
    const ui = await mountPane($, 24)
    const tree = (await ui.drawn()) as Node
    expect(allText(findKey(tree, 'tile-hours-value'))).toMatch(/[┏┃┗┓┛━╺╸╻╹]/)
    expect(allText(findKey(tree, 'tile-tasks-value'))).toMatch(/[┏┃┗┓┛━╺╸╻╹]/)
    await ui.unmount()
  })

  test('a number too wide for big numerals is plain bold text inside the tile', async ($, on) => {
    const crowded: Record<string, unknown> = {}
    crowded[`day:${TODAY}`] = day({ documents: 9999 })
    await setup($, on, crowded)
    const ui = await mountPane($, 24)
    const tree = (await ui.drawn()) as Node
    const dollars = allText(findKey(tree, 'tile-dollars-value'))
    expect(dollars).not.toMatch(/[┏┃┗┓┛━╺╸╻╹]/)
    expect(dollars).toContain('$249,975')
    expect(overflows(tree, 24)).toEqual([])
    await ui.unmount()
  })

  test('text helpers never exceed the width', () => {
    expect(fit('abcdefghij', 5)).toHaveLength(5)
    for (const line of wrapWords(EMPTY_TODAY, 18)) expect(line.length).toBeLessThanOrEqual(18)
    const bars = chartBars('month', {}, TODAY)
    for (const slot of [1, 2, 3, 4]) expect(chartLabels('month', bars, slot)).toHaveLength(slot * 30)
    expect(chartLabels('year', chartBars('year', {}, TODAY), 4)).toHaveLength(48)
  })
})

// ---------------------------------------------------------------------------
// The command and the draw rule
// ---------------------------------------------------------------------------

// The input the engine raises for a typed slash command.
function runCommand($: any, args: string) {
  return $.command.run({
    command: 'report',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  } as never)
}

describe('command and draw', () => {
  test('/report settings lists the values; a change is saved; a bad value gets a sentence', async ($, on) => {
    mock.clock(on, { now: NOW })
    const store = memoryStore(on)
    on('command.run', () => ({ text: 'bottom' }))
    const listed = await runCommand($, 'settings')
    expect(listed.text).toContain('rate: 50')
    expect(listed.text).toContain('emails: 10')
    expect(listed.text).toContain('ESTIMATE')
    const changed = await runCommand($, 'settings rate 75')
    expect(changed.text).toContain('75')
    expect((store.get('settings') as { rate: number }).rate).toBe(75)
    await runCommand($, 'settings emails 15')
    expect((store.get('settings') as { minutes: { emails: number } }).minutes.emails).toBe(15)
    const bad = await runCommand($, 'settings rate lots')
    expect(bad.text).toContain('not a good value')
    const missing = await runCommand($, 'settings rate')
    expect(missing.text).toContain('Give a number')
  })

  test('a draw does not save anything', async ($, on) => {
    const store = await setup($, on, seed())
    const ui = await mountPane($, 100)
    const before = JSON.stringify([...store.entries()])
    for (const tab of ['week', 'month', 'year', 'today']) {
      await ui.press({ key: `tab-${tab}` })
      await ui.drawn()
    }
    expect(JSON.stringify([...store.entries()])).toBe(before)
    await ui.unmount()
  })
})
