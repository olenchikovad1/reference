import { describe, expect, it } from 'vitest'
import { selectPlmImage, colorwayColourCode, readinessLines, plmOpenUrl, savedPlmColorway } from './plm'

describe('PLM readiness', () => {
  it('distinguishes unavailable marks from an explicit absence', () => {
    expect(readinessLines(undefined).every(row => row.state === 'не передано')).toBe(true)
    expect(readinessLines({ size_charts: 'none', patterns: 'partial', technology: 'full' }).map(row => row.state))
      .toEqual(['нет', 'в работе', 'есть', 'не передано'])
  })
  it('keeps saved external identity and only opens a relative PLM path on HTTP(S)', () => {
    expect(savedPlmColorway({ plm: { colorwayId: 'real-id' } })).toBe('real-id')
    expect(savedPlmColorway({ plm: { colorwayId: 123 } })).toBeNull()
    expect(savedPlmColorway(null)).toBeNull()
    expect(plmOpenUrl('https://platform.test/plm/', '/colorways/real-id')).toBe('https://platform.test/plm/colorways/real-id')
    expect(plmOpenUrl('https://platform.test/plm/', '//other.test')).toBeNull()
    expect(plmOpenUrl('javascript:alert(1)', '/colorways/real-id')).toBeNull()
    expect(plmOpenUrl('https://platform.test/plm/', 'javascript:alert(1)')).toBeNull()
  })
})

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
