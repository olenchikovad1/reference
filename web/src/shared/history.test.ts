import { describe, expect, it } from 'vitest'

import { DEPTH, canRedo, canUndo, push, redo, start, switchTo, undo } from './history'

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

describe('история на референс (US-0683)', () => {
  const same = (a: string, b: string) => a === b

  it('открыть другой референс — его история чистая: отмена не приносит соседнюю работу', () => {
    const a = push(push(start('№234 до'), '№234 сдвинут'), '№234 ещё')
    const { shelf, h } = switchTo(new Map(), 234, a, 241, '№241 мяч', same)
    expect(canUndo(h)).toBe(false)
    expect(h.present).toBe('№241 мяч')
    expect(shelf.get(234)?.present).toBe('№234 ещё')
  })

  it('вернулся к референсу — его отмена снова с того места', () => {
    const a = push(start('№234 до'), '№234 сдвинут')
    const away = switchTo(new Map(), 234, a, 241, '№241 мяч', same)
    const back = switchTo(away.shelf, 241, away.h, 234, '№234 сдвинут', same)
    expect(undo(back.h).present).toBe('№234 до')
  })

  it('на полке не то, что открыли (поменяли в другом месте) — история заново', () => {
    const a = push(start('№234 до'), '№234 сдвинут')
    const away = switchTo(new Map(), 234, a, 241, '№241', same)
    const back = switchTo(away.shelf, 241, away.h, 234, '№234 сохранён другим', same)
    expect(canUndo(back.h)).toBe(false)
  })
})
