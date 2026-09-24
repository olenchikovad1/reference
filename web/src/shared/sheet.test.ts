import { describe as group, expect, it } from 'vitest'

import { EMPTY, add, type Composition, type ImageElement, type TextElement } from './composition'
import { describe } from './sheet'

const picture = (id: string, over: Partial<ImageElement['placement']> = {}): ImageElement => ({
  id,
  kind: 'image',
  name: `${id}.png`,
  src: `blob:${id}`,
  aspect: 2,
  hasAlpha: true,
  placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 20, rotation: 0, ...over },
})

const label: TextElement = {
  id: 't',
  kind: 'text',
  name: 'надпись',
  text: 'ЗИМА 2026',
  fontFamily: 'Oswald',
  weight: 600,
  colourCode: 'WHITE',
  rgb: [255, 255, 255],
  textAspect: 4,
  placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 30, widthCm: 12, rotation: 0 },
}

const one = (c: Composition = EMPTY) => add(c, picture('a'))

group('спецификация листа', () => {
  it('пустая композиция даёт пустой лист, а не ошибку', () => {
    expect(describe(EMPTY)).toEqual({ widthCm: 0, heightCm: 0, items: [] })
  })

  it('габарит одного элемента — его собственный размер', () => {
    const s = describe(one())
    expect(s.widthCm).toBeCloseTo(20)
    expect(s.heightCm).toBeCloseTo(10)
  })

  it('поворот увеличивает габарит, а не оставляет прежним', () => {
    // На фабрику уходит место, которое печать реально займёт. Повёрнутый
    // прямоугольник занимает больше — считать по неповёрнутому значит заказать
    // печать меньшего размера, чем нужно.
    const straight = describe(add(EMPTY, picture('a')))
    const turned = describe(add(EMPTY, picture('a', { rotation: 45 })))
    expect(turned.widthCm).toBeGreaterThan(straight.widthCm)
    expect(turned.heightCm).toBeGreaterThan(straight.heightCm)
  })

  it('габарит охватывает все элементы, а не последний', () => {
    const s = describe(add(one(), label))
    // Картинка на 12 см, надпись на 30 — лист обязан накрыть обе.
    expect(s.heightCm).toBeGreaterThan(20)
  })

  it('у надписи в спецификации стоит сам текст, а не имя элемента', () => {
    const s = describe(add(EMPTY, label))
    expect(s.items[0].name).toBe('ЗИМА 2026')
  })

  it('размещение переносится в спецификацию как есть', () => {
    const item = describe(one()).items[0]
    expect(item).toMatchObject({ anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 20, rotation: 0 })
  })
})
