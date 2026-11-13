// Pure logic: sorting tasks, dates, totals, streaks, chart data, settings commands.
// Nothing here touches the engine. Dates are stepped at LOCAL NOON so a clock change
// (DST) never moves a day.

import type { DayRecord, KindId, Settings, TabId } from '../types'

export const KINDS: readonly { id: KindId; label: string }[] = [
  { id: 'emails', label: 'Emails' },
  { id: 'documents', label: 'Documents' },
  { id: 'images', label: 'Images and video' },
  { id: 'research', label: 'Research' },
  { id: 'other', label: 'Other' },
]

export const DEFAULT_SETTINGS: Settings = {
  rate: 50,
  minutes: { emails: 10, documents: 30, images: 20, research: 25, other: 10 },
}

export const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_SHORT = MONTH_NAMES.map(name => name.slice(0, 3))
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const NOON = 12

// ---------------------------------------------------------------------------
// Sorting a task into a kind
// ---------------------------------------------------------------------------

export type ToolSeen = { name: string; path?: string }

const EMAIL_TOOL = /gmail|e-?mail|outlook|(^|[^a-z])mail([^a-z]|$)|smtp|imap/i
const IMAGE_TOOL =
  /image|video|photo|picture|(^|[^a-z])img([^a-z]|$)|veo|sora|imagen|dall-?e|midjourney|diffusion|flow_(generate|edit|assemble|character|narrate|agent_images|continue|download)|gif_creator/i
const DOCUMENT_TOOL =
  /docx|pptx|xlsx|spreadsheet|presentation|slides?([^a-z]|$)|sheets?([^a-z]|$)|(create|update|write|edit)[_-]?(doc|document|page)|doc_page|google[_-]?(docs|sheets|slides)|^Artifact$/i
const RESEARCH_TOOL =
  /^(WebSearch|WebFetch)$|web[_-]?(search|fetch)|transcript|scrape|crawl|firecrawl|tavily|perplexity|(^|[^a-z])exa([^a-z]|$)|context7|query-docs|resolve-library-id|get_page_text|read_page|browser|navigate|brave[_-]?search/i

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|svg|ico|heic|mp4|mov|webm|mkv|avi|m4v|mp3|wav)$/i
const DOCUMENT_EXT = /\.(docx?|odt|rtf|pptx?|key|xlsx?|ods|csv|pdf|md)$/i
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/

/** The kind one tool call points at, or undefined when it points at none. */
export function classifyTool(name: string, path?: string): KindId | undefined {
  if (WRITE_TOOLS.test(name)) {
    if (path !== undefined && IMAGE_EXT.test(path)) return 'images'
    if (path !== undefined && DOCUMENT_EXT.test(path)) return 'documents'
    return undefined
  }
  if (EMAIL_TOOL.test(name)) return 'emails'
  if (IMAGE_TOOL.test(name)) return 'images'
  if (DOCUMENT_TOOL.test(name)) return 'documents'
  if (RESEARCH_TOOL.test(name)) return 'research'
  return undefined
}

// When one task used tools of several kinds, the first kind in this list wins.
const KIND_PRIORITY: readonly KindId[] = ['emails', 'images', 'documents', 'research']

/** Sorts a whole task into ONE kind by the tools its main loop used. */
export function classifyTask(calls: readonly ToolSeen[]): KindId {
  const found = new Set<KindId>()
  for (const call of calls) {
    const kind = classifyTool(call.name, call.path)
    if (kind !== undefined) found.add(kind)
  }
  for (const kind of KIND_PRIORITY) {
    if (found.has(kind)) return kind
  }
  return 'other'
}

// ---------------------------------------------------------------------------
// Counting only typed prompts
// ---------------------------------------------------------------------------

// A prompt counts when a person wrote it: the terminal, the phone/web bridge, or an SDK host.
const TYPED_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

export function isTypedPrompt(origin: { kind: string } | undefined, text: string): boolean {
  if (origin === undefined || !TYPED_ORIGINS.has(origin.kind)) return false
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (trimmed.startsWith('/')) return false
  return true
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** A short, stable name for a model id ("claude-sonnet-4-5-20250929" gives "Sonnet 4.5"). */
export function modelLabel(raw: string | undefined): string {
  if (raw === undefined) return 'Unknown'
  const text = raw.trim().replace(/\[[^\]]*\]$/, '')
  if (text.length === 0) return 'Unknown'
  const family = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
  const modern = /claude[-_](opus|sonnet|haiku|fable)[-_](\d+)(?:[-_.](\d{1,2}))?(?!\d)/i.exec(text)
  if (modern && modern[1] && modern[2]) {
    const version = modern[3] ? `${modern[2]}.${modern[3]}` : modern[2]
    return `${family(modern[1])} ${version}`
  }
  const legacy = /claude[-_](\d+)(?:[-_.](\d{1,2}))?[-_](opus|sonnet|haiku)/i.exec(text)
  if (legacy && legacy[1] && legacy[3]) {
    const version = legacy[2] ? `${legacy[1]}.${legacy[2]}` : legacy[1]
    return `${family(legacy[3])} ${version}`
  }
  return text.length > 24 ? text.slice(0, 24) : text
}

// ---------------------------------------------------------------------------
// Day records
// ---------------------------------------------------------------------------

export function emptyKinds(): Record<KindId, number> {
  return { emails: 0, documents: 0, images: 0, research: 0, other: 0 }
}

export function emptyDay(): DayRecord {
  return { kinds: emptyKinds(), models: {} }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Reads a day record from stored JSON, repairing anything odd. */
export function readDay(value: unknown): DayRecord {
  const day = emptyDay()
  if (typeof value !== 'object' || value === null) return day
  const source = value as { kinds?: unknown; models?: unknown }
  if (typeof source.kinds === 'object' && source.kinds !== null) {
    const kinds = source.kinds as Record<string, unknown>
    for (const kind of KINDS) day.kinds[kind.id] = count(kinds[kind.id])
  }
  if (typeof source.models === 'object' && source.models !== null) {
    for (const [name, value2] of Object.entries(source.models as Record<string, unknown>)) {
      const amount = count(value2)
      if (amount > 0) day.models[name] = amount
    }
  }
  return day
}

/** A new record with one more task of the kind, done by the model. */
export function addTaskToDay(day: DayRecord | undefined, kind: KindId, model: string): DayRecord {
  const base = readDay(day)
  base.kinds[kind] += 1
  base.models[model] = (base.models[model] ?? 0) + 1
  return base
}

export function dayTotal(day: DayRecord | undefined): number {
  if (day === undefined) return 0
  let total = 0
  for (const kind of KINDS) total += day.kinds[kind.id] ?? 0
  return total
}

export type Totals = {
  total: number
  kinds: Record<KindId, number>
  models: Record<string, number>
}

/** Adds the records of several days together. */
export function sumDays(records: readonly (DayRecord | undefined)[]): Totals {
  const sum: Totals = { total: 0, kinds: emptyKinds(), models: {} }
  for (const record of records) {
    if (record === undefined) continue
    for (const kind of KINDS) {
      const amount = record.kinds[kind.id] ?? 0
      sum.kinds[kind.id] += amount
      sum.total += amount
    }
    for (const [name, amount] of Object.entries(record.models)) {
      sum.models[name] = (sum.models[name] ?? 0) + amount
    }
  }
  return sum
}

// ---------------------------------------------------------------------------
// Dates (local, stepped at noon)
// ---------------------------------------------------------------------------

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** The local date key (YYYY-MM-DD) of a moment in milliseconds. */
export function dateKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

export function parseKey(key: string): { year: number; month: number; day: number } {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number)
  return { year, month, day }
}

/** The local date at noon for a key. Noon is far from any clock change. */
export function noonOf(key: string): Date {
  const { year, month, day } = parseKey(key)
  return new Date(year, month - 1, day, NOON, 0, 0, 0)
}

/** The key `count` days after (or before, if negative) the key. */
export function addDays(key: string, amount: number): string {
  const { year, month, day } = parseKey(key)
  return dateKey(new Date(year, month - 1, day + amount, NOON, 0, 0, 0).getTime())
}

/** Day of the year, 1 to 366: January 1 is 1. */
export function dayOfYear(key: string): number {
  const { year } = parseKey(key)
  const start = new Date(year, 0, 1, NOON, 0, 0, 0).getTime()
  return Math.round((noonOf(key).getTime() - start) / 86400000) + 1
}

export function weekdayOf(key: string): number {
  return noonOf(key).getDay()
}

/** All keys from first to last, both included. */
export function keysBetween(first: string, last: string): string[] {
  const keys: string[] = []
  let current = first
  // Guard against a reversed range and runaway loops.
  for (let step = 0; step < 4000 && current <= last; step += 1) {
    keys.push(current)
    current = addDays(current, 1)
  }
  return keys
}

export function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[weekdayOf(key)] ?? ''
}

export function dayMonthShort(key: string): string {
  const { month, day } = parseKey(key)
  return `${day} ${MONTH_SHORT[month - 1] ?? ''}`
}

export function fullDay(key: string): string {
  const { year } = parseKey(key)
  return `${weekdayShort(key)} ${dayMonthShort(key)} ${year}`
}

export type Stretch = { first: string; last: string; keys: string[] }

/** The days a tab covers, ending today. */
export function stretchFor(tab: TabId, today: string): Stretch {
  let first = today
  if (tab === 'week') first = addDays(today, -6)
  if (tab === 'month') first = addDays(today, -29)
  if (tab === 'year') first = `${parseKey(today).year}-01-01`
  return { first, last: today, keys: keysBetween(first, today) }
}

export function stretchTitle(tab: TabId, today: string): string {
  if (tab === 'today') return 'TODAY'
  if (tab === 'week') return 'LAST 7 DAYS'
  if (tab === 'month') return 'LAST 30 DAYS'
  return `YEAR ${parseKey(today).year}`
}

export function stretchDates(tab: TabId, today: string): string {
  const stretch = stretchFor(tab, today)
  if (tab === 'today') return fullDay(today)
  const firstYear = parseKey(stretch.first).year
  const lastYear = parseKey(stretch.last).year
  if (firstYear !== lastYear) return `${fullDayNoWeekday(stretch.first)} - ${fullDayNoWeekday(stretch.last)}`
  return `${dayMonthShort(stretch.first)} - ${dayMonthShort(stretch.last)} ${lastYear}`
}

function fullDayNoWeekday(key: string): string {
  return `${dayMonthShort(key)} ${parseKey(key).year}`
}

// ---------------------------------------------------------------------------
// Streak, estimate, formatting
// ---------------------------------------------------------------------------

/**
 * Days in a row with at least one task, counted back from today.
 * A quiet today does not break the streak: it counts from yesterday then.
 */
export function streak(days: Readonly<Record<string, DayRecord | undefined>>, today: string): number {
  let current = today
  if (dayTotal(days[current]) === 0) current = addDays(current, -1)
  let run = 0
  for (let step = 0; step < 4000; step += 1) {
    if (dayTotal(days[current]) === 0) break
    run += 1
    current = addDays(current, -1)
  }
  return run
}

export type Estimate = { minutes: number; hours: number; dollars: number }

export function estimate(totals: Totals, settings: Settings): Estimate {
  let minutes = 0
  for (const kind of KINDS) minutes += totals.kinds[kind.id] * settings.minutes[kind.id]
  const hours = minutes / 60
  return { minutes, hours, dollars: hours * settings.rate }
}

export function formatHours(hours: number): string {
  return String(Math.round(hours * 10) / 10)
}

export function formatCount(value: number): string {
  return String(value)
}

export function formatMoney(dollars: number): string {
  const whole = String(Math.round(dollars))
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ---------------------------------------------------------------------------
// The report: everything the pane draws, worked out from the saved days
// ---------------------------------------------------------------------------

export type Bar = {
  label: string
  value: number
  isHighlight: boolean
  isFuture: boolean
}

export type ChartKind = 'week' | 'month' | 'year'

export type Report = {
  tab: TabId
  title: string
  dates: string
  totals: Totals
  estimate: Estimate
  kindRows: { id: KindId; label: string; count: number; hours: number }[]
  modelRows: { name: string; count: number }[]
  chartKind: ChartKind
  bars: Bar[]
  summary: string
  emptyText: string | undefined
  todayTotal: number
}

export const EMPTY_TODAY = 'Nothing finished yet today. Your first finished task shows up here.'
const EMPTY_STRETCH = 'Nothing finished in this stretch yet. Your first finished task shows up here.'

function plural(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`
}

export function chartBars(tab: TabId, days: Readonly<Record<string, DayRecord | undefined>>, today: string): Bar[] {
  if (tab === 'year') {
    const { year, month: thisMonth } = parseKey(today)
    const bars: Bar[] = []
    for (let month = 1; month <= 12; month += 1) {
      const prefix = `${year}-${two(month)}-`
      let value = 0
      for (const [key, record] of Object.entries(days)) {
        if (key.startsWith(prefix)) value += dayTotal(record)
      }
      const isFuture = month > thisMonth
      bars.push({
        label: MONTH_SHORT[month - 1] ?? '',
        value: isFuture ? 0 : value,
        isHighlight: month === thisMonth,
        isFuture,
      })
    }
    return bars
  }
  const length = tab === 'month' ? 30 : 7
  const bars: Bar[] = []
  for (let back = length - 1; back >= 0; back -= 1) {
    const key = addDays(today, -back)
    bars.push({
      label: tab === 'month' ? String(parseKey(key).day) : weekdayShort(key),
      value: dayTotal(days[key]),
      isHighlight: back === 0,
      isFuture: false,
    })
  }
  return bars
}

export function buildReport(
  tab: TabId,
  days: Readonly<Record<string, DayRecord | undefined>>,
  settings: Settings,
  today: string,
): Report {
  const stretch = stretchFor(tab, today)
  const totals = sumDays(stretch.keys.map(key => days[key]))
  const money = estimate(totals, settings)

  const kindRows = KINDS.map(kind => ({
    id: kind.id,
    label: kind.label,
    count: totals.kinds[kind.id],
    hours: (totals.kinds[kind.id] * settings.minutes[kind.id]) / 60,
  }))
  const modelRows = Object.entries(totals.models)
    .map(([name, amount]) => ({ name, count: amount }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))

  const chartKind: ChartKind = tab === 'month' ? 'month' : tab === 'year' ? 'year' : 'week'

  let summary: string
  if (tab === 'today' || tab === 'week') {
    const run = streak(days, today)
    summary =
      run === 0
        ? 'Streak: 0 days. Finish a task to start one.'
        : `Streak: ${plural(run, 'day', 'days')} in a row.`
  } else if (tab === 'month') {
    summary = bestSummary(stretch.keys, days, 'day')
  } else {
    summary = bestSummary(stretch.keys, days, 'month')
  }

  return {
    tab,
    title: stretchTitle(tab, today),
    dates: stretchDates(tab, today),
    totals,
    estimate: money,
    kindRows,
    modelRows,
    chartKind,
    bars: chartBars(tab, days, today),
    summary,
    emptyText: totals.total === 0 ? (tab === 'today' ? EMPTY_TODAY : EMPTY_STRETCH) : undefined,
    todayTotal: dayTotal(days[today]),
  }
}

function bestSummary(
  keys: readonly string[],
  days: Readonly<Record<string, DayRecord | undefined>>,
  by: 'day' | 'month',
): string {
  let activeDays = 0
  const perMonth: number[] = new Array(12).fill(0)
  let bestKey: string | undefined
  let bestDayTotal = 0
  for (const key of keys) {
    const amount = dayTotal(days[key])
    if (amount === 0) continue
    activeDays += 1
    perMonth[parseKey(key).month - 1] = (perMonth[parseKey(key).month - 1] ?? 0) + amount
    if (amount > bestDayTotal) {
      bestDayTotal = amount
      bestKey = key
    }
  }
  if (activeDays === 0) return 'No active days yet.'
  const activeText = plural(activeDays, 'active day', 'active days')
  if (by === 'day' && bestKey !== undefined) {
    return `Best day: ${weekdayShort(bestKey)} ${dayMonthShort(bestKey)}, ${plural(bestDayTotal, 'task', 'tasks')}. ${activeText}.`
  }
  let bestMonth = 0
  let bestMonthTotal = 0
  perMonth.forEach((amount, index) => {
    if (amount > bestMonthTotal) {
      bestMonthTotal = amount
      bestMonth = index
    }
  })
  return `Best month: ${MONTH_NAMES[bestMonth] ?? ''}, ${plural(bestMonthTotal, 'task', 'tasks')}. ${activeText}.`
}

// ---------------------------------------------------------------------------
// Settings command: /report settings [name value]
// ---------------------------------------------------------------------------

const SETTING_NAMES = ['rate', 'emails', 'documents', 'images', 'research', 'other'] as const
type SettingName = (typeof SETTING_NAMES)[number]
const MAX_RATE = 100000
const MAX_MINUTES = 1440

export function describeSettings(settings: Settings): string {
  const lines = [
    'Work Report settings. All hours and dollars are an ESTIMATE.',
    `rate: ${settings.rate} dollars per hour`,
  ]
  for (const kind of KINDS) {
    lines.push(`${kind.id}: ${settings.minutes[kind.id]} minutes per task (${kind.label})`)
  }
  lines.push('Change one: /report settings rate 75 or /report settings emails 15')
  return lines.join('\n')
}

export type SettingsChange = { settings: Settings; text: string }

/** Applies "name value" to the settings. Returns the new settings and a plain sentence. */
export function changeSetting(settings: Settings, name: string, rawValue: string): SettingsChange {
  const key = name.toLowerCase()
  const alias: Record<string, SettingName> = { media: 'images', video: 'images', image: 'images', email: 'emails' }
  const known = (SETTING_NAMES as readonly string[]).includes(key)
    ? (key as SettingName)
    : alias[key]
  if (known === undefined) {
    return {
      settings,
      text: `I do not know "${name}". Use one of: ${SETTING_NAMES.join(', ')}.`,
    }
  }
  const value = Number(rawValue)
  const limit = known === 'rate' ? MAX_RATE : MAX_MINUTES
  if (rawValue.trim() === '' || !Number.isFinite(value) || value < 0 || value > limit) {
    return {
      settings,
      text: `"${rawValue}" is not a good value for ${known}. Use a number from 0 to ${limit}.`,
    }
  }
  const next: Settings = { rate: settings.rate, minutes: { ...settings.minutes } }
  if (known === 'rate') {
    next.rate = value
    return { settings: next, text: `Rate is now ${value} dollars per hour (an estimate).` }
  }
  next.minutes[known] = value
  return { settings: next, text: `${known} is now ${value} minutes per task (an estimate).` }
}

/** Reads stored settings, repairing anything odd. */
export function readSettings(value: unknown): Settings {
  const settings: Settings = { rate: DEFAULT_SETTINGS.rate, minutes: { ...DEFAULT_SETTINGS.minutes } }
  if (typeof value !== 'object' || value === null) return settings
  const source = value as { rate?: unknown; minutes?: unknown }
  if (typeof source.rate === 'number' && Number.isFinite(source.rate) && source.rate >= 0) {
    settings.rate = source.rate
  }
  if (typeof source.minutes === 'object' && source.minutes !== null) {
    const minutes = source.minutes as Record<string, unknown>
    for (const kind of KINDS) {
      const entry = minutes[kind.id]
      if (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0) {
        settings.minutes[kind.id] = entry
      }
    }
  }
  return settings
}

/** Which tab a word names, if any. */
export function tabFromWord(word: string): TabId | undefined {
  const lower = word.toLowerCase()
  return TABS.find(tab => tab.id === lower)?.id
}
