// Клавиши рабочего окна (US-0492): одна таблица, любая раскладка, в полях
// ввода буквы печатаются.

import { describe, expect, it } from 'vitest'

import { windowKey } from './keys'

const k = (code: string, key = '', extra: Partial<KeyboardEventInit> = {}) =>
  ({ code, key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra }) as KeyboardEvent

describe('клавиши окна', () => {
  it('в русской раскладке: A и D — соседняя карточка, Q и E — история, 1/2/3 — виды', () => {
    expect(windowKey(k('KeyA', 'ф'), false)).toEqual({ kind: 'card', back: true })
    expect(windowKey(k('KeyD', 'в'), false)).toEqual({ kind: 'card', back: false })
    expect(windowKey(k('KeyQ', 'й'), false)).toEqual({ kind: 'older' })
    expect(windowKey(k('KeyE', 'у'), false)).toEqual({ kind: 'newer' })
    expect(windowKey(k('Digit2', '2'), false)).toEqual({ kind: 'view', index: 1 })
  })

  it('в поле ввода буквы и цифры печатаются, а Ctrl+S и Esc работают', () => {
    expect(windowKey(k('KeyA', 'ф'), true)).toBeNull()
    expect(windowKey(k('Digit1', '1'), true)).toBeNull()
    expect(windowKey(k('ArrowLeft'), true)).toBeNull()
    expect(windowKey(k('Backspace'), true)).toBeNull()
    expect(windowKey(k('KeyS', 'ы', { ctrlKey: true }), true)).toEqual({ kind: 'save' })
    expect(windowKey(k('Escape', 'Escape'), true)).toEqual({ kind: 'escape' })
  })

  it('стрелки двигают на миллиметр, с Shift — на сантиметр', () => {
    expect(windowKey(k('ArrowRight'), false)).toEqual({ kind: 'nudge', dxCm: 0.1, dyCm: 0 })
    expect(windowKey(k('ArrowUp', '', { shiftKey: true }), false)).toEqual({ kind: 'nudge', dxCm: 0, dyCm: -1 })
  })

  it('+ и − приближают, 0 вписывает, ? — шпаргалка', () => {
    expect(windowKey(k('Equal', '='), false)).toEqual({ kind: 'zoom', by: 'in' })
    expect(windowKey(k('Equal', '+', { shiftKey: true }), false)).toEqual({ kind: 'zoom', by: 'in' })
    expect(windowKey(k('NumpadSubtract', '-'), false)).toEqual({ kind: 'zoom', by: 'out' })
    expect(windowKey(k('Digit0', '0'), false)).toEqual({ kind: 'zoom', by: 'fit' })
    expect(windowKey(k('Slash', '?', { shiftKey: true }), false)).toEqual({ kind: 'help' })
    expect(windowKey(k('Digit7', '?', { shiftKey: true }), false)).toEqual({ kind: 'help' })
  })

  it('Tab — по объектам, Shift+Tab — назад; Ctrl+Z — отмена, Delete — убрать', () => {
    expect(windowKey(k('Tab', 'Tab'), false)).toEqual({ kind: 'next', back: false })
    expect(windowKey(k('Tab', 'Tab', { shiftKey: true }), false)).toEqual({ kind: 'next', back: true })
    expect(windowKey(k('KeyZ', 'я', { ctrlKey: true }), false)).toEqual({ kind: 'undo' })
    expect(windowKey(k('Delete', 'Delete'), false)).toEqual({ kind: 'remove' })
  })
})
