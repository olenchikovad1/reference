// Многоцветный принт (US-0503): основные краски, замена, дуотон, тон, и
// число красок — по объявленному, а не угаданному.

import { describe, expect, it } from 'vitest'

import { applyLook, declaredInks, mainColours } from './look'

/** Две краски по четыре точки: оранжевая и синяя. */
const two = () =>
  new Uint8ClampedArray([
    250, 140, 20, 255, 240, 130, 10, 255, 255, 150, 30, 255, 245, 135, 15, 255,
    20, 40, 200, 255, 25, 45, 210, 255, 15, 35, 190, 255, 22, 42, 205, 255,
  ])

describe('многоцветный принт', () => {
  it('находит основные краски с долями', () => {
    const found = mainColours(two())
    expect(found).toHaveLength(2)
    expect(found.map((f) => f.share)).toEqual([0.5, 0.5])
  })

  it('замена одной краски не трогает другую, полутона внутри на месте', () => {
    const d = two()
    const found = mainColours(d)
    const orange = found.find((f) => f.rgb[0] > f.rgb[2])!
    const blue = found.find((f) => f.rgb[2] > f.rgb[0])!
    applyLook(d, { swaps: [{ from: orange.rgb, to: { code: 'RED', rgb: [200, 0, 0] } }, { from: blue.rgb, to: null }] })
    expect(d[1]).toBeLessThan(20) // зелёного в оранжевом не осталось — он красный
    expect(d[0] - d[4]).toBe(10) // разница двух оранжевых точек сохранилась
    expect([d[16], d[17], d[18]]).toEqual([20, 40, 200]) // синий как был
  })

  it('дуотон — ровно две краски, светлая точка — светлой краской', () => {
    const d = two()
    applyLook(d, { duotone: [{ code: 'BLACK', rgb: [0, 0, 0] }, { code: 'WHITE', rgb: [255, 255, 255] }] })
    const colours = new Set<string>()
    for (let i = 0; i < d.length; i += 4) colours.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
    expect([...colours].sort()).toEqual(['0,0,0', '255,255,255'])
    expect([d[0], d[1], d[2]]).toEqual([255, 255, 255])
  })

  it('поворот оттенка на полкруга делает оранжевый синим', () => {
    const d = two()
    applyLook(d, { hue: 180 })
    expect(d[2]).toBeGreaterThan(d[0])
  })

  it('число красок — по объявленному', () => {
    const ink = (code: string) => ({ code, rgb: [0, 0, 0] as const })
    expect(declaredInks(undefined)).toBeNull()
    expect(declaredInks({ duotone: [ink('A'), ink('B')] })).toEqual(['A', 'B'])
    expect(declaredInks({ swaps: [{ from: [0, 0, 0], to: ink('A') }, { from: [1, 1, 1], to: null }] })).toBeNull()
    expect(declaredInks({ swaps: [{ from: [0, 0, 0], to: ink('A') }, { from: [9, 9, 9], to: ink('A') }] })).toEqual(['A'])
    expect(declaredInks({ tint: ink('RED') })).toEqual(['RED'])
  })
})
