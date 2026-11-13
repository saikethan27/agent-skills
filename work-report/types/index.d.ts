export type KindId = 'emails' | 'documents' | 'images' | 'research' | 'other'

export type TabId = 'today' | 'week' | 'month' | 'year'

/** One calendar day: how many tasks of each kind, and how many per model. */
export type DayRecord = {
  kinds: Record<KindId, number>
  models: Record<string, number>
}

export type Settings = {
  /** Dollars per hour. */
  rate: number
  /** Minutes saved per task, by kind. */
  minutes: Record<KindId, number>
}

declare module 'claude-code' {
  interface PluginState {
    'work-report': {
      /** The chosen tab of the pane. */
      tab: TabId
      /** Cache of the saved day records, by local date key (YYYY-MM-DD). */
      days: Record<string, DayRecord>
      /** The estimate settings. */
      settings: Settings
    }
  }
}
