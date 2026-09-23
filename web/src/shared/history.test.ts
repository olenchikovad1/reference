import { describe, expect, it } from 'vitest'

import { DEPTH, canRedo, canUndo, push, redo, start, undo } from './history'

const steps = (n: number) =>
  Array.from({ length: n }, (_, i) => i + 1).reduce((h, v) => push(h, v), start(0))

describe('отмена и повтор', () => {
  it('в начале отменять нечего', () => {
    expect(canUndo(start(0))).toBe(false)
    expect(canRedo(start(0))).toBe(false)
  })

  it('снимает действия по одному, в обратном порядке', () => {
    let h = steps(3)
    expect(h.present).toBe(3)
    h = undo(h)
    expect(h.present).toBe(2)
    h = undo(h)
    expect(h.present).toBe(1)
  })

  it('повтор возвращает ровно то же', () => {
    const h = steps(3)
    expect(redo(undo(h)).present).toBe(3)
  })

  it('новое действие после отмены обрывает будущее', () => {
    // Иначе «вперёд» вело бы в ветку, которой человек уже не выбрал, и
    // повтор возвращал бы то, чего он не делал.
    const h = push(undo(steps(3)), 99)
    expect(canRedo(h)).toBe(false)
    expect(h.present).toBe(99)
  })

  it('повтор одного и того же состояния шагом не считается', () => {
    const h = steps(2)
    expect(push(h, h.present)).toBe(h)
  })

  it('глубины хватает вернуться к началу сеанса', () => {
    let h = steps(DEPTH)
    for (let i = 0; i < DEPTH; i += 1) h = undo(h)
    expect(canUndo(h)).toBe(false)
  })

  it('дальше глубины история не растёт', () => {
    expect(steps(DEPTH + 50).past.length).toBe(DEPTH)
  })

  it('отменять на пустой истории безопасно', () => {
    const h = start('x')
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })
})
