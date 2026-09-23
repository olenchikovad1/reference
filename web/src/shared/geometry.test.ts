import { describe, expect, it } from 'vitest'

import { cmToPx, formatCm, offsetFromAnchor, pointFromAnchor, pxToCm } from './geometry'

const calibration = { pxPerCm: 8.2, provisional: true }

describe('перевод сантиметров в пиксели', () => {
  it('туда и обратно возвращает то же число', () => {
    expect(pxToCm(cmToPx(12, calibration), calibration)).toBeCloseTo(12)
  })

  it('двенадцать сантиметров при 8.2 px/см это 98.4 пикселя', () => {
    expect(cmToPx(12, calibration)).toBeCloseTo(98.4)
  })
})

describe('смещение от ориентира', () => {
  const neck = [360, 215] as const

  it('«12 см ниже горловины» уходит вниз по кадру, а не вверх', () => {
    const [, y] = pointFromAnchor(neck, { x: 0, y: 12 }, calibration)
    expect(y).toBeGreaterThan(neck[1])
  })

  it('возвращает ровно то смещение, из которого точка получена', () => {
    const point = pointFromAnchor(neck, { x: -3, y: 12 }, calibration)
    const back = offsetFromAnchor(neck, point, calibration)
    expect(back.x).toBeCloseTo(-3)
    expect(back.y).toBeCloseTo(12)
  })
})

describe('показ сантиметров', () => {
  it('оставляет один знак: миллиметры видны, шум — нет', () => {
    expect(formatCm(12.34)).toBe('12.3 см')
  })
})
