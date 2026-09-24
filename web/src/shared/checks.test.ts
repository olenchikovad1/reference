import { describe, expect, it } from 'vitest'

import { DEFAULT_THRESHOLDS, blocking, check, letterHeightCm } from './checks'
import { EMPTY, add, type Composition, type ImageElement, type TextElement } from './composition'

const label = (over: Partial<TextElement> = {}): TextElement => ({
  id: over.id ?? 't',
  kind: 'text',
  name: 'надпись',
  text: 'ЗИМА',
  fontFamily: 'Oswald',
  weight: 600,
  colourCode: 'WHITE',
  rgb: [255, 255, 255],
  textAspect: 4,
  placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 20, rotation: 0 },
  ...over,
})

const picture: ImageElement = {
  id: 'i',
  kind: 'image',
  name: 'tank.png',
  src: 'blob:i',
  aspect: 2,
  hasAlpha: true,
  placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 20, rotation: 0 },
}

/** Надпись заданной высоты буквы: ширина подбирается от пропорции. */
const withLetter = (cm: number): TextElement =>
  label({ placement: { ...label().placement, widthCm: (cm / 0.7) * 4 } })

const rules = (c: Composition) => check(c).map((f) => f.rule)

describe('высота буквы', () => {
  it('крупная надпись находок не даёт', () => {
    expect(rules(add(EMPTY, withLetter(2)))).toEqual([])
  })

  it('3 мм — блокирующая: такая буква не пропечатается', () => {
    const found = check(add(EMPTY, withLetter(0.3)))
    expect(found.some((f) => f.rule === 'letter-height' && f.weight === 'blocking')).toBe(true)
  })

  it('5 мм — предупреждение, а не запрет', () => {
    const found = check(add(EMPTY, withLetter(0.5)))
    const letter = found.filter((f) => f.rule === 'letter-height')
    expect(letter).toHaveLength(1)
    expect(letter[0].weight).toBe('warning')
  })

  it('8 мм гасит находку совсем', () => {
    expect(rules(add(EMPTY, withLetter(0.8)))).toEqual([])
  })
})

describe('толщина штриха', () => {
  it('у мелкой надписи штрих тоньше порога и это блокирует', () => {
    const found = check(add(EMPTY, withLetter(0.2)))
    expect(found.some((f) => f.rule === 'stroke-width' && f.weight === 'blocking')).toBe(true)
  })
})

describe('число цветов', () => {
  it('до порога молчит', () => {
    let c: Composition = EMPTY
    for (let i = 0; i < 3; i += 1) {
      c = add(c, withLetter(2))
    }
    expect(rules(c).filter((r) => r === 'colour-count')).toEqual([])
  })

  it('растровый элемент честно говорит, что его цвета не посчитаны', () => {
    // Угаданное число хуже отсутствующего: человек решит, что проверка была.
    const found = check(add(EMPTY, picture))
    expect(found.some((f) => f.rule === 'colour-count' && /не посчитаны/.test(f.message))).toBe(true)
  })
})

describe('вес находок', () => {
  it('блокирующие отделяются от предупреждений', () => {
    const found = check(add(add(EMPTY, withLetter(0.2)), picture))
    expect(blocking(found).every((f) => f.weight === 'blocking')).toBe(true)
    expect(blocking(found).length).toBeLessThan(found.length)
  })
})

describe('пороги', () => {
  it('приходят снаружи, а не зашиты', () => {
    // У шелкографии и DTF они разные, и менять их будет технолог.
    const strict = { ...DEFAULT_THRESHOLDS, minLetterCm: 3 }
    expect(check(add(EMPTY, withLetter(2)), strict).length).toBeGreaterThan(0)
  })
})

describe('высота буквы из кегля', () => {
  it('у картинки буквы нет вовсе', () => {
    expect(letterHeightCm(picture)).toBe(0)
  })
})
