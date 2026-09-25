// Перекраска принта без новой картинки (US-0502): форма и полутона на месте.

import { describe, expect, it } from 'vitest'

import { recolor } from './look'

/** Три точки красного принта: тень, середина, блик — и одна прозрачная. */
const reds = () => new Uint8ClampedArray([120, 0, 0, 255, 200, 20, 20, 255, 250, 120, 120, 255, 10, 10, 10, 0])

describe('перекраска', () => {
  it('полутона сохраняются: разница яркостей между точками та же', () => {
    const d = reds()
    const before = [0, 4, 8].map((i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
    // Краска средней яркости: у яркой блик упирается в 255 и обрезается — это
    // свойство перекраски, проверяется здесь другое.
    recolor(d, [30, 60, 120])
    const after = [0, 4, 8].map((i) => d[i + 2])
    expect(after[1] - after[0]).toBeCloseTo(before[1] - before[0], 0)
    expect(after[2] - after[1]).toBeCloseTo(before[2] - before[1], 0)
  })

  it('принт становится краской: средняя точка — почти сама краска', () => {
    const d = reds()
    recolor(d, [30, 60, 200])
    expect(d[6]).toBeGreaterThan(d[4]) // синий больше красного
  })

  it('прозрачность не трогается, прозрачная точка не перекрашивается', () => {
    const d = reds()
    recolor(d, [30, 60, 200])
    expect([d[3], d[7], d[11], d[15]]).toEqual([255, 255, 255, 0])
    expect([d[12], d[13], d[14]]).toEqual([10, 10, 10])
  })

  it('чёрный принт: полутона не стираются', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 40, 40, 40, 255])
    recolor(d, [200, 0, 0])
    expect(d[4]).toBeGreaterThan(d[0])
  })
})
