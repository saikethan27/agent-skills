// Work Report: wiring. Records finished tasks, answers /report, draws the pane and the button.
// A draw only reads. State changes come from events, commands and button presses.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayRecord, TabId } from '../types'
import {
  addDays,
  addTaskToDay,
  buildReport,
  changeSetting,
  classifyTask,
  dateKey,
  dayTotal,
  describeSettings,
  isTypedPrompt,
  modelLabel,
  readDay,
  readSettings,
  tabFromWord,
} from './logic'
import type { ToolSeen } from './logic'
import { SIZE } from './tokens'
import { drawBand, drawReport } from './view'

const PANE = 'work-report'
const PANE_TITLE = 'Work Report'
const DAY_PREFIX = 'day:'
const SETTINGS_KEY = 'settings'

const tabAtom = atom({ plugin: 'work-report', key: 'tab' } as const, 'today' as TabId)
const daysAtom = atom({ plugin: 'work-report', key: 'days' } as const, {} as Record<string, DayRecord>)
const settingsAtom = atom(
  { plugin: 'work-report', key: 'settings' } as const,
  readSettings(undefined),
)

type Active = { turnId: string; tools: ToolSeen[] }

function pathOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const fields = input as Record<string, unknown>
  for (const name of ['file_path', 'notebook_path', 'path']) {
    const value = fields[name]
    if (typeof value === 'string') return value
  }
  return undefined
}

/** Opens the pane without waiting for it, so a command or a press answers at once. */
function openPane($: EngineInterface): void {
  try {
    Promise.resolve($.ui.open({ id: PANE, title: PANE_TITLE })).catch(() => undefined)
  } catch {
    // A failed open must never break the caller.
  }
}

/** Loads settings and the recent day records from the store into the state cache. */
async function loadSaved($: EngineInterface): Promise<void> {
  const settings = readSettings(await $.store.get(SETTINGS_KEY))
  const today = dateKey(await $.clock.now())
  const cutoff = addDays(today, -SIZE.loadDays)
  const loaded: Record<string, DayRecord> = {}
  for (const name of await $.store.keys()) {
    if (!name.startsWith(DAY_PREFIX)) continue
    const key = name.slice(DAY_PREFIX.length)
    if (key < cutoff) continue
    loaded[key] = readDay(await $.store.get(name))
  }
  await update($, settingsAtom, () => settings)
  await update($, daysAtom, () => loaded)
}

/** Saves one finished task into the record of its calendar day, in the mod's own store. */
async function recordTask($: EngineInterface, kind: ReturnType<typeof classifyTask>, model: string): Promise<void> {
  const key = dateKey(await $.clock.now())
  const stored = await $.store.get(DAY_PREFIX + key)
  const record = addTaskToDay(stored === undefined ? undefined : readDay(stored), kind, model)
  await $.store.set(DAY_PREFIX + key, record)
  await update($, daysAtom, days => ({ ...days, [key]: record }))
}

/** Runs /report. Answers with a plain sentence and never throws. */
async function runReport($: EngineInterface, args: string): Promise<{ text: string }> {
  const words = args.trim().split(/\s+/).filter(word => word.length > 0)
  const first = (words[0] ?? '').toLowerCase()

  if (first === 'settings') {
    const current = readSettings(await $.store.get(SETTINGS_KEY))
    if (words.length === 1) return { text: describeSettings(current) }
    const name = words[1] ?? ''
    if (words.length < 3) return { text: `Give a number: /report settings ${name} 75` }
    const change = changeSetting(current, name, words[2] ?? '')
    if (change.settings !== current) {
      await $.store.set(SETTINGS_KEY, change.settings)
      await update($, settingsAtom, () => change.settings)
    }
    return { text: change.text }
  }

  const wanted = tabFromWord(first)
  if (wanted !== undefined) await update($, tabAtom, () => wanted)
  openPane($)
  if (first !== '' && wanted === undefined) {
    return { text: 'Work Report opened. Use: /report [today|week|month|year|settings]' }
  }
  return { text: 'Work Report opened.' }
}

// A watching hook that fails lets the event go on as if it were not there. Nothing is blocked.
export const register: Register = on => {
  // The typed prompt that is waiting for its turn, and the task being watched.
  let pendingAt: number | undefined
  let active: Active | undefined

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'report',
        description: 'Show what Claude has done for you: tasks, hours and dollars saved (estimate)',
        argumentHint: '[today|week|month|year|settings]',
      })
    } catch {
      // The command is missing, but the rest still works.
    }
    try {
      await loadSaved($)
    } catch {
      // Start with an empty cache; new tasks are still saved.
    }
    return next(e)
  })

  // Step 1: a prompt a person typed. Folded prompts (typed during a turn) and slash commands do not count.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (e.turnId === undefined && isTypedPrompt(e.origin, e.text)) {
        pendingAt = await $.clock.now()
      }
    } catch {
      pendingAt = undefined
    }
    const entered = await next(e)
    if (entered.drop !== undefined) pendingAt = undefined
    return entered
  }).catch(($, e, next) => next(e))

  // Step 2: the turn that prompt starts. Any other turn (helper agent, notification, schedule) is not watched.
  on('turn.start', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      const isTyped = pendingAt !== undefined && now - pendingAt <= SIZE.maxStaleMs
      active = isTyped ? { turnId: e.turnId, tools: [] } : undefined
      pendingAt = undefined
    } catch {
      active = undefined
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Step 3: the tools that turn uses decide the kind.
  on('tool.call', async (_$, e, next) => {
    try {
      if (active !== undefined) {
        active.tools.push({ name: String(e.tool), path: pathOf(e) })
      }
    } catch {
      // Watching must never block a tool.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Step 4: only an answered, main-loop turn counts. Cancelled or failed turns are dropped.
  on('turn.complete', async ($, e, next) => {
    try {
      const task = active
      if (e.agentId === undefined && task !== undefined && task.turnId === e.turnId) {
        active = undefined
        if (e.reason === 'answer') {
          const model = modelLabel(e.usage?.model ?? (await $.session.model()))
          await recordTask($, classifyTask(task.tools), model)
        }
      }
    } catch {
      // A failed save must not break the turn.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'report' }, async ($, e) => {
    try {
      return await runReport($, e.args)
    } catch {
      return { text: 'Work Report could not do that. Try /report again.' }
    }
  }).catch(() => ({ text: 'Work Report hit a problem. Try /report again.' }))

  // The pane. This only reads.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
      const tab = await read($, tabAtom)
      const days = await read($, daysAtom)
      const settings = readSettings(await read($, settingsAtom))
      const today = dateKey(await $.clock.now())
      const report = buildReport(tab, days, settings, today)
      return drawReport($.ui.resolve(e), {
        report,
        cells: e.props.bodyColumns ?? e.viewport?.columns,
        onTab: id => update($, tabAtom, () => id),
      })
    } catch {
      return next(e)
    }
  })

  // The one button: a gold chip above the prompt. This only reads.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const days = await read($, daysAtom)
      const today = dateKey(await $.clock.now())
      return drawBand($.ui.resolve(e), {
        cells: e.props.bodyColumns,
        todayTotal: dayTotal(days[today]),
        onOpen: () => openPane($),
      })
    } catch {
      return next(e)
    }
  })
}
