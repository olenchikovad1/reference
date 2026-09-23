// Отрисовка надписи на холст композиции.
//
// Текст рисуется КАЖДЫЙ раз заново, а не кэшируется картинкой: в этом весь
// смысл истории — правка буквы не должна проходить через дизайнера.

export interface TextStyle {
  readonly text: string
  readonly fontFamily: string
  readonly weight: number
  readonly rgb: readonly [number, number, number]
}

/** Пропорция надписи при данном начертании: ширина к высоте. */
export function measureAspect(
  ctx: CanvasRenderingContext2D,
  style: TextStyle,
  probeSize = 100,
): number {
  ctx.save()
  ctx.font = `${style.weight} ${probeSize}px "${style.fontFamily}", sans-serif`
  const m = ctx.measureText(style.text || ' ')
  const ascent = m.actualBoundingBoxAscent || probeSize * 0.75
  const descent = m.actualBoundingBoxDescent || probeSize * 0.25
  ctx.restore()
  const height = Math.max(ascent + descent, 1)
  return Math.max(m.width, 1) / height
}

/** Рисует надпись, вписанную по ширине в заданный прямоугольник. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  style: TextStyle,
  widthPx: number,
): void {
  // Кегль подбирается от ширины: человек задаёт ширину надписи на изделии в
  // сантиметрах, а не размер шрифта в пунктах — на фабрику уходят сантиметры.
  const probe = 100
  ctx.font = `${style.weight} ${probe}px "${style.fontFamily}", sans-serif`
  const unit = Math.max(ctx.measureText(style.text || ' ').width, 1)
  const size = (widthPx / unit) * probe
  ctx.font = `${style.weight} ${size}px "${style.fontFamily}", sans-serif`
  ctx.fillStyle = `rgb(${style.rgb[0]}, ${style.rgb[1]}, ${style.rgb[2]})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(style.text, 0, 0)
}
