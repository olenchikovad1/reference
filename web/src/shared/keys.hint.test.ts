// Подсказка «?» (US-0631) не обещает того, чего нет: каждое нажатие из
// таблицы окна разбирается в действие.

import { describe, expect, it } from 'vitest'

import { WINDOW_KEYS, windowKey } from './keys'

describe('подсказка клавиш окна', () => {
  it.each(WINDOW_KEYS.flatMap((row) => (row.probe ?? []).map((p) => [row.keys, p] as const)))(
    '%s — разбирается',
    (_keys, p) => {
      const e = { key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...p } as KeyboardEvent
      expect(windowKey(e, false)).not.toBeNull()
    },
  )

  it('у каждой строки окна есть проверочное нажатие', () => {
    expect(WINDOW_KEYS.every((r) => (r.probe?.length ?? 0) > 0)).toBe(true)
  })
})
