import { describe, expect, it } from 'vitest'
import { fitCanvasImage, canvasViews, encodeCanvasComposition, decodeCanvasComposition } from './plmCanvas'
import { tryOnComposition } from './tryOn'

describe('единый холст PLM', () => {
  it('вписывает широкий и высокий кадры без обрезки и растяжения', () => {
    expect(fitCanvasImage(2048, 1024)).toEqual({ x: 0, y: 256, width: 1024, height: 512 })
    expect(fitCanvasImage(500, 1000)).toEqual({ x: 256, y: 0, width: 512, height: 1024 })
    expect(fitCanvasImage(300, 300)).toEqual({ x: 0, y: 0, width: 1024, height: 1024 })
  })
  it('не принимает пустое изображение', () => {
    expect(() => fitCanvasImage(0, 20)).toThrow()
  })
  it('различает реальные ракурсы и исключает цветовую заглушку', () => {
    expect(canvasViews([
      { key: 'swatch', name: 'GeneratedColoredImage.png' },
      { key: 'b', side: null, name: 'LRTT спинка.png' },
      { key: 'f', side: null, name: 'LRTT перед.png' },
      { key: 'l', name: 'бок слева.png' },
    ]).map(v => [v.code, v.image.key])).toEqual([['front', 'f'], ['back', 'b'], ['left', 'l']])
  })
  it('берёт основной неподписанный ракурс и не повторяет один ключ', () => {
    expect(canvasViews([{ key: 'one', name: 'Модель.png' }, { key: 'one', name: 'Модель.png' },
      { key: 'back', name: 'Модель_Back.png' }]).map(view => view.code)).toEqual(['front', 'back'])
  })
  it('сохраняет координаты холста без сантиметров и восстанавливает редактирование', () => {
    const original = tryOnComposition('/print', 'Принт', 2, true)
    const saved = encodeCanvasComposition(original)
    expect(JSON.stringify(saved)).not.toMatch(/Cm|BySize/)
    expect(decodeCanvasComposition(saved)).toEqual({ ...original, selectedId: null })
  })
})
