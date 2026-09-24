// Отмена и повтор с клавиатуры — в любой раскладке.
//
// Сравнивать надо физическую клавишу, а не букву: в русской раскладке клавиша Z
// даёт «я», и отмена по букве молча не срабатывала — ровно у тех, кто
// работает в русской раскладке, то есть почти у всех.

import { describe, expect, it } from 'vitest'

import { historyKey } from './keys'

const key = (code: string, key: string, extra: Partial<KeyboardEventInit> = {}) =>
  ({ code, key, ctrlKey: true, metaKey: false, shiftKey: false, ...extra }) as KeyboardEvent

describe('отмена с клавиатуры', () => {
  it('Ctrl+Z в русской раскладке — отмена', () => {
    expect(historyKey(key('KeyZ', 'я'))).toBe('undo')
  })

  it('Ctrl+Z в английской — отмена', () => {
    expect(historyKey(key('KeyZ', 'z'))).toBe('undo')
  })

  it('Ctrl+Shift+Z и Ctrl+Y — повтор', () => {
    expect(historyKey(key('KeyZ', 'Я', { shiftKey: true }))).toBe('redo')
    expect(historyKey(key('KeyY', 'н'))).toBe('redo')
  })

  it('Cmd на маке — то же, что Ctrl', () => {
    expect(historyKey(key('KeyZ', 'z', { ctrlKey: false, metaKey: true }))).toBe('undo')
  })

  it('без модификатора — не отмена', () => {
    expect(historyKey(key('KeyZ', 'я', { ctrlKey: false }))).toBeNull()
  })
})
