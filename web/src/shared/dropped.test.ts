import { describe, expect, it } from 'vitest'

import { detectAlpha } from './dropped'

const rgba = (...px: number[][]) => new Uint8ClampedArray(px.flat())

describe('прозрачность брошенной картинки', () => {
  it('находит полностью прозрачный пиксель', () => {
    expect(detectAlpha(rgba([1, 2, 3, 255], [0, 0, 0, 0]))).toBe(true)
  })

  it('находит полупрозрачный — мягкий край тоже считается', () => {
    expect(detectAlpha(rgba([1, 2, 3, 255], [4, 5, 6, 200]))).toBe(true)
  })

  it('на сплошном непрозрачном отвечает нет: такая картинка ляжет прямоугольником', () => {
    expect(detectAlpha(rgba([1, 2, 3, 255], [4, 5, 6, 255]))).toBe(false)
  })
})
