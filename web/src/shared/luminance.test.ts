import { describe, expect, it } from 'vitest'

import { alphaOf, boxBlur, buildLuminance, luminanceOf, whitePoint } from './luminance'

/** Кадр 4×1: три светлых пикселя изделия и один прозрачный фон. */
const frame = new Uint8ClampedArray([
  200, 200, 200, 255, //
  245, 245, 245, 255,
  56, 56, 56, 255,
  0, 0, 0, 0,
])

describe('яркость кадра', () => {
  it('берётся из канала: кадр обесцвечен, каналы совпадают', () => {
    expect([...luminanceOf(frame)]).toEqual([200, 245, 56, 0])
  })

  it('альфа отделяется — по ней принт отсекается по силуэту', () => {
    expect([...alphaOf(frame)]).toEqual([255, 255, 255, 0])
  })
})

describe('опорный белый', () => {
  it('это самая светлая точка изделия, а не 255', () => {
    // У нашего кадра белое равно 245. Делить на 255 значит сделать принт
    // систематически темнее изделия, на котором он лежит.
    expect(whitePoint(luminanceOf(frame), alphaOf(frame))).toBe(245)
  })

  it('прозрачный фон в расчёт не идёт', () => {
    const dark = new Uint8ClampedArray([10, 10, 10, 255, 255, 255, 255, 0])
    expect(whitePoint(luminanceOf(dark), alphaOf(dark))).toBe(10)
  })
})

describe('размытие', () => {
  it('при нулевом радиусе возвращает копию, а не тот же массив', () => {
    const src = new Uint8ClampedArray([1, 2, 3, 4])
    const out = boxBlur(src, 4, 1, 0)
    expect([...out]).toEqual([1, 2, 3, 4])
    expect(out).not.toBe(src)
  })

  it('сглаживает одиночный выброс', () => {
    const src = new Uint8ClampedArray([0, 0, 240, 0, 0])
    const out = boxBlur(src, 5, 1, 1)
    expect(out[2]).toBeLessThan(240)
    expect(out[1]).toBeGreaterThan(0)
  })

  it('на ровном поле ничего не меняет', () => {
    const src = new Uint8ClampedArray(9).fill(100)
    expect([...boxBlur(src, 3, 3, 1)]).toEqual([...src])
  })
})

describe('сборка карты', () => {
  it('отдаёт и сырую яркость, и размытую, и опорный белый', () => {
    const m = buildLuminance(frame, 4, 1, 1)
    expect(m.width).toBe(4)
    expect(m.white).toBe(245)
    expect(m.raw.length).toBe(4)
    expect(m.blurred.length).toBe(4)
    // Размытая отличается от сырой: иначе градиента не будет, а с ним и рельефа.
    expect([...m.blurred]).not.toEqual([...m.raw])
  })
})
