import { describe, expect, it } from 'vitest'

import { bounds, contains, coverage } from './mask'

const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
] as const

// Невыпуклая зона: капюшон именно такой, и проверка обязана его понимать.
const notch = [
  [0, 0],
  [10, 0],
  [10, 10],
  [6, 10],
  [6, 4],
  [4, 4],
  [4, 10],
  [0, 10],
] as const

describe('точка в зоне', () => {
  it('внутри — да', () => {
    expect(contains(square, [5, 5])).toBe(true)
  })

  it('снаружи — нет', () => {
    expect(contains(square, [15, 5])).toBe(false)
  })

  it('в вырезе невыпуклой зоны — нет', () => {
    expect(contains(notch, [5, 8])).toBe(false)
  })

  it('рядом с вырезом, но в теле — да', () => {
    expect(contains(notch, [2, 8])).toBe(true)
  })
})

describe('габарит', () => {
  it('охватывает все вершины', () => {
    expect(bounds(notch)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 10 })
  })
})

describe('насколько накрыт прямоугольник', () => {
  it('целиком внутри — единица', () => {
    expect(coverage(square, { x: 2, y: 2, width: 4, height: 4 })).toBe(1)
  })

  it('целиком снаружи — ноль', () => {
    expect(coverage(square, { x: 20, y: 20, width: 4, height: 4 })).toBe(0)
  })

  it('наполовину — примерно половина', () => {
    // Мера приблизительная по устройству: она нужна, чтобы сказать человеку
    // «скрыто примерно столько», а не чтобы считать площадь.
    const half = coverage(square, { x: 5, y: 2, width: 10, height: 4 })
    expect(half).toBeGreaterThan(0.4)
    expect(half).toBeLessThan(0.6)
  })
})
