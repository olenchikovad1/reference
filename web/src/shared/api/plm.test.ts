import { describe, expect, it } from 'vitest'
import { selectPlmImage, colorwayColourCode } from './plm'

describe('PLM image choice', () => {
  it('keeps the Pantone code instead of its display name or unrelated base color', () => {
    expect(colorwayColourCode({ color: '18-1222 TPG Cocoa Brown', base_color: 'STEEL VIOLET' }, [
      { code: '18-1222 TPG', code_short: '18-1222', name: 'Какао', group: 'Какао', rgb: [112, 89, 77] },
    ])).toBe('18-1222 TPG')
  })
  it('shows the real Russian front instead of the generated swatch', () => {
    expect(selectPlmImage([
      { key: 'swatch', name: 'GeneratedColoredImage-R240-G240-B241.png' },
      { key: 'back', name: 'Лотта 3 спинка.png' },
      { key: 'front', name: 'Лотта 1 перед.png' },
    ])).toBe('front')
  })
  it('prefers the explicit front and does not invent absent images', () => {
    expect(selectPlmImage([{ key: 'back', side: 'back' }, { key: 'front', side: 'front' }])).toBe('front')
    expect(selectPlmImage([{ key: 'swatch', name: 'GeneratedColoredImage.png' }])).toBeNull()
    expect(selectPlmImage(undefined)).toBeNull()
  })
})
