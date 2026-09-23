import { describe, expect, it } from 'vitest'

import { EMPTY, add, find, heightCm, restyle, retype } from './composition'
import type { TextElement } from './composition'

const label = (): TextElement => ({
  id: 't1',
  kind: 'text',
  name: 'надпись',
  text: 'ЗИМА 2026',
  fontFamily: 'Oswald',
  weight: 600,
  colourCode: 'WHITE',
  rgb: [255, 255, 255],
  textAspect: 4,
  placement: { anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 20, rotation: 0 },
})

describe('надпись как элемент композиции', () => {
  it('высота считается по пропорции отрисованного, а не по пропорции файла', () => {
    expect(heightCm(label())).toBe(5)
  })

  it('правка текста не трогает ни место, ни начертание', () => {
    const c = retype(add(EMPTY, label()), 't1', 'ЛЕТО 2026')
    const el = find(c, 't1')
    expect(el?.kind === 'text' && el.text).toBe('ЛЕТО 2026')
    expect(el?.placement.dyCm).toBe(12)
    expect(el?.kind === 'text' && el.fontFamily).toBe('Oswald')
  })

  it('смена шрифта не трогает текст', () => {
    const c = restyle(add(EMPTY, label()), 't1', { fontFamily: 'Caveat' })
    const el = find(c, 't1')
    expect(el?.kind === 'text' && el.fontFamily).toBe('Caveat')
    expect(el?.kind === 'text' && el.text).toBe('ЗИМА 2026')
  })

  it('не правит композицию на месте', () => {
    const before = add(EMPTY, label())
    const after = retype(before, 't1', 'другое')
    expect(before.elements[0]).not.toBe(after.elements[0])
  })

  it('правка чужого элемента ничего не ломает', () => {
    const c = add(EMPTY, label())
    expect(retype(c, 'нет-такого', 'x').elements[0]).toEqual(c.elements[0])
  })
})
