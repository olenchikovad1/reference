// Контраст принта с цветом изделия (US-0500).

import { describe, expect, it } from 'vitest'

import { add, EMPTY, type TextElement } from './composition'
import { contrastRatio, lowContrast } from './contrast'

const white = [255, 255, 255] as const
const black = [0, 0, 0] as const

function words(rgb: readonly [number, number, number]): TextElement {
  return {
    id: 't', kind: 'text', name: 'надпись', text: 'ЗИМА', fontFamily: 'Oswald', weight: 600, colourCode: 'WHITE',
    rgb: [...rgb] as [number, number, number], textAspect: 3,
    placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
  }
}

describe('контраст принта с изделием', () => {
  it('чёрный на белом — 21, одинаковые — 1', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
  })

  it('белая надпись пропадает на белой худи и читается на чёрной', () => {
    const c = add(EMPTY, words(white))
    expect(lowContrast(c, white, 'белой', new Map())).toHaveLength(1)
    expect(lowContrast(c, black, 'чёрной', new Map())).toHaveLength(0)
  })

  it('картинка без известного цвета не проверяется', () => {
    const c = add(EMPTY, { id: 'i', kind: 'image', name: 'танк', src: '/x.png', aspect: 1, hasAlpha: true,
      placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 } })
    expect(lowContrast(c, white, 'белой', new Map())).toEqual([])
    expect(lowContrast(c, white, 'белой', new Map([['/x.png', [250, 250, 250] as const]]))).toHaveLength(1)
  })
})
