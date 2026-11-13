// Big numerals, three rows tall, drawn with heavy box-drawing characters.

import { SIZE } from './tokens'

const GLYPHS: Record<string, readonly [string, string, string]> = {
  '0': ['┏━┓', '┃ ┃', '┗━┛'],
  '1': ['╺┓ ', ' ┃ ', '╺┻╸'],
  '2': ['╺━┓', '┏━┛', '┗━╸'],
  '3': ['╺━┓', ' ━┫', '╺━┛'],
  '4': ['╻ ╻', '┗━┫', '  ╹'],
  '5': ['┏━╸', '┗━┓', '╺━┛'],
  '6': ['┏━╸', '┣━┓', '┗━┛'],
  '7': ['╺━┓', '  ┃', '  ╹'],
  '8': ['┏━┓', '┣━┫', '┗━┛'],
  '9': ['┏━┓', '┗━┫', '╺━┛'],
  '$': ['┏╋╸', '┗╋┓', '╺╋┛'],
  '.': [' ', ' ', '■'],
  ',': [' ', ' ', '╹'],
}

/** Width in cells of a string drawn as big numerals, or -1 when a character has no glyph. */
export function bigWidth(text: string): number {
  if (text.length === 0) return 0
  let total = 0
  for (const ch of text) {
    const glyph = GLYPHS[ch]
    if (glyph === undefined) return -1
    total += glyph[0].length
  }
  return total + (text.length - 1) * SIZE.bigGap
}

/** The three rows of the numerals, or undefined when a character has no glyph. */
export function bigRows(text: string): string[] | undefined {
  if (bigWidth(text) < 0 || text.length === 0) return undefined
  const rows: string[] = []
  for (let row = 0; row < SIZE.bigDigitRows; row += 1) {
    const parts: string[] = []
    for (const ch of text) {
      const glyph = GLYPHS[ch]
      parts.push(glyph ? (glyph[row] ?? '') : '')
    }
    rows.push(parts.join(' '.repeat(SIZE.bigGap)))
  }
  return rows
}
