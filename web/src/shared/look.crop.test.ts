// Обрезка рамкой и фигурой (US-0504): в долях исходника, масштаб прежний.

import { describe, expect, it } from 'vitest'

import { add, EMPTY, heightCm, recrop, type ImageElement } from './composition'
import { clampCrop, FULL } from './look'

const tank: ImageElement = {
  id: 'i', kind: 'image', name: 'танк', src: '/t.png', aspect: 2, hasAlpha: true,
  placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 20, rotation: 0 },
}

describe('обрезка', () => {
  it('половина по ширине — кусок вдвое уже той же высоты', () => {
    const c = recrop(add(EMPTY, tank), 'i', { x: 0.25, y: 0, w: 0.5, h: 1, shape: 'rect' })
    const el = c.elements[0] as ImageElement
    expect(el.placement.widthCm).toBeCloseTo(10)
    expect(heightCm(el)).toBeCloseTo(heightCm(tank))
    expect(el.look?.crop?.x).toBe(0.25)
  })

  it('раздвинуть обратно — исходник цел, размер как был', () => {
    let c = recrop(add(EMPTY, tank), 'i', { x: 0.25, y: 0.25, w: 0.5, h: 0.5, shape: 'ellipse' })
    c = recrop(c, 'i', FULL)
    const el = c.elements[0] as ImageElement
    expect(el.placement.widthCm).toBeCloseTo(20)
    expect(el.aspect).toBeCloseTo(2)
  })

  it('рамка не выходит за исходник и не схлопывается', () => {
    expect(clampCrop({ x: 0.9, y: -1, w: 0.5, h: 0, shape: 'rect' })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.02, shape: 'rect' })
  })
})
