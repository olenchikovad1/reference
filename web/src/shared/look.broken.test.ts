// Битая картинка элемента не роняет окно (28.09.2026): у незагрузившейся
// картинки complete === true, а размеров нет, и drawImage бросал
// InvalidStateError — падало всё приложение, а не один элемент.

import { describe, expect, it, vi } from 'vitest'

import { drawLooked } from './look'

describe('drawLooked', () => {
  it('битую картинку пропускает, а не бросает', () => {
    const drawImage = vi.fn(() => {
      throw new DOMException('broken', 'InvalidStateError')
    })
    const ctx = { drawImage, globalAlpha: 1 } as unknown as CanvasRenderingContext2D
    const broken = { complete: true, naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement
    expect(() => drawLooked(ctx, broken, undefined, 0, 0, 10, 10)).not.toThrow()
    expect(drawImage).not.toHaveBeenCalled()
  })
})
