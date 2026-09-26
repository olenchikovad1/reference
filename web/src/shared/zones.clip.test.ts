// Обрезка по разметке изделия (US-0505): граница — линия изделия, а не рамка
// картинки. Проверяется то, что держат все пути: контур от ориентира, а не от
// принта; поле своё на размере; проверки и лист видят обрезанное.

import { describe, expect, it } from 'vitest'

import { add, EMPTY, place, type ClipTo, type ImageElement } from './composition'
import type { Calibration } from './geometry'
import type { Polygon } from './mask'
import { describe as describeSheet } from './sheet'
import { checkZones, clipOutline } from './zones'

const CAL: Calibration = { pxPerCm: 10, provisional: true }

// Зона 200×200 пикселей = 20×20 см, горловина в центре, молния по середине.
const STATE = {
  code: 'front',
  kind: 'precise' as const,
  anchors: { neck: [100, 100] as [number, number] },
  zones: { print: [[0, 0], [200, 0], [200, 200], [0, 200]] as [number, number][] },
  lines: { zipper: [[100, 0], [100, 200]] as [number, number][] },
}

function big(clip: ClipTo | null, dxCm = 0): ImageElement {
  return {
    id: 'b',
    kind: 'image',
    name: 'большой',
    src: '/b.png',
    aspect: 1,
    hasAlpha: true,
    placement: { side: 'front', anchor: 'neck', dxCm, dyCm: 0, widthCm: 30, rotation: 0, clip },
  }
}

const xs = (p: Polygon) => p.map((q) => q[0])

describe('обрезка по разметке', () => {
  it('по печатному полю — контур поля, в см от ориентира', () => {
    const poly = clipOutline(big('field'), STATE, CAL)!
    expect(Math.min(...xs(poly))).toBeCloseTo(-10)
    expect(Math.max(...xs(poly))).toBeCloseTo(10)
  })

  it('сдвинули принт — граница на месте', () => {
    const a = clipOutline(big('field', 0), STATE, CAL)
    const b = clipOutline(big('field', 7), STATE, CAL)
    expect(b).toEqual(a)
  })

  it('поле другого размера — другая граница', () => {
    const small: Polygon = [[50, 50], [150, 50], [150, 150], [50, 150]]
    const poly = clipOutline(big('field'), STATE, CAL, small)!
    expect(Math.max(...xs(poly))).toBeCloseTo(5)
  })

  it('левее молнии — правый край по молнии', () => {
    const poly = clipOutline(big('zipper-left'), STATE, CAL)!
    expect(Math.max(...xs(poly))).toBeCloseTo(0)
    expect(Math.min(...xs(poly))).toBeLessThan(-50)
  })

  it('обрезанное по полю за поле не выходит, по молнии — её не пересекает', () => {
    const rules = (clip: ClipTo | null) => checkZones(add(EMPTY, big(clip)), STATE, CAL).map((f) => f.rule)
    expect(rules(null)).toEqual(expect.arrayContaining(['out-of-print-field', 'crosses-line']))
    expect(rules('field')).not.toContain('out-of-print-field')
    expect(rules('zipper-right')).not.toContain('crosses-line')
  })

  it('целиком за линией — сказано, что не напечатается ничего', () => {
    const c = place(add(EMPTY, big('zipper-left')), 'b', { dxCm: 30, widthCm: 4 })
    expect(checkZones(c, STATE, CAL).map((f) => f.rule)).toContain('clipped-away')
  })

  it('печатный лист не шире поля', () => {
    const el = big('field')
    const clips = new Map([[el.id, clipOutline(el, STATE, CAL)!]])
    expect(describeSheet(add(EMPTY, el)).widthCm).toBeCloseTo(30)
    expect(describeSheet(add(EMPTY, el), clips).widthCm).toBeCloseTo(20)
  })

  it('на стороне без молнии обрезки по молнии нет', () => {
    expect(clipOutline(big('zipper-left'), { ...STATE, lines: {} }, CAL)).toBeNull()
  })
})
