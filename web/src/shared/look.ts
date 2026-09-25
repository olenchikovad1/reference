// Вид картинки принта без новой картинки (US-0502): краска и прозрачность.
//
// Исходник не меняется никогда — у элемента хранятся параметры, а
// перекрашенная копия считается в памяти и кэшируется по картинке и краске.
// Применяется одной функцией везде: на изделии, на миниатюрах, в снимке
// витрины и на печатном листе — на фабрику уходит ровно то, что утвердили.
// Это арифметика над точками, а не генеративная модель (запрет 4): форма
// принта не перерисовывается.

export type Rgb = readonly [number, number, number]

export interface Look {
  /** Краска палитры, в которую перекрашен одноцветный принт; нет — исходный. */
  readonly tint?: { readonly code: string; readonly rgb: Rgb } | null
  /** Непрозрачность 0–1: насколько принт закрывает ткань. Нет — 1. */
  readonly opacity?: number
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * Перекрасить точки в краску, сохранив форму и полутона: каждая точка
 * получает цвет краски, сдвинутый на то, насколько она светлее или темнее
 * средней по принту. Прозрачность точек не трогается. Сдвиг, а не умножение:
 * у чёрного принта средняя яркость ноль, и умножение стёрло бы полутона.
 */
export function recolor(data: Uint8ClampedArray, [tr, tg, tb]: Rgb): void {
  let sum = 0
  let weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255
    if (a === 0) continue
    sum += lum(data[i], data[i + 1], data[i + 2]) * a
    weight += a
  }
  const mean = weight > 0 ? sum / weight : 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const shift = lum(data[i], data[i + 1], data[i + 2]) - mean
    data[i] = tr + shift
    data[i + 1] = tg + shift
    data[i + 2] = tb + shift
  }
}

const tintedCache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>()

/** Перекрашенная копия картинки — одна на картинку и краску. */
function tinted(img: HTMLImageElement, rgb: Rgb): HTMLCanvasElement | null {
  const key = rgb.join(',')
  let byTint = tintedCache.get(img)
  if (!byTint) tintedCache.set(img, (byTint = new Map()))
  const hit = byTint.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx || !c.width) return null
  ctx.drawImage(img, 0, 0)
  const px = ctx.getImageData(0, 0, c.width, c.height)
  recolor(px.data, rgb)
  ctx.putImageData(px, 0, 0)
  byTint.set(key, c)
  return c
}

/** Нарисовать картинку элемента с её видом — единственный путь для всех. */
export function drawLooked(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  look: Look | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const source = look?.tint ? (tinted(img, look.tint.rgb) ?? img) : img
  const alpha = ctx.globalAlpha
  ctx.globalAlpha = alpha * Math.min(1, Math.max(0, look?.opacity ?? 1))
  ctx.drawImage(source, x, y, w, h)
  ctx.globalAlpha = alpha
}
