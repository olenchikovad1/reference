// Вид картинки принта без новой картинки (US-0502, US-0503): краска,
// прозрачность, замена основных красок, дуотон, тон.
//
// Исходник не меняется никогда — у элемента хранятся параметры, а
// изменённая копия считается в памяти и кэшируется по картинке и параметрам.
// Применяется одной функцией везде: на изделии, на миниатюрах, в снимке
// витрины и на печатном листе — на фабрику уходит ровно то, что утвердили.
// Это арифметика над точками, а не генеративная модель (запрет 4): форма
// принта не перерисовывается.

export type Rgb = readonly [number, number, number]

/** Краска палитры: код уходит на фабрику, цвет — для показа. */
export interface Ink {
  readonly code: string
  readonly rgb: Rgb
}

/** Фигура обрезки (US-0504) внутри рамки. */
export type CropShape = 'rect' | 'ellipse' | 'hexagon'

/** Обрезка в ДОЛЯХ исходника, а не в точках экрана: печатный лист режет тот
 *  же кусок, какого бы размера ни была картинка на экране. */
export interface Crop {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly shape: CropShape
}

export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1, shape: 'rect' }

/** Рамка в пределах исходника: не меньше 2 % и не за краем. */
export function clampCrop(c: Crop): Crop {
  const w = Math.min(1, Math.max(0.02, c.w))
  const h = Math.min(1, Math.max(0.02, c.h))
  return { ...c, w, h, x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)) }
}

/** Вершины фигуры в долях рамки. */
export function shapePoints(shape: CropShape): readonly [number, number][] | null {
  if (shape !== 'hexagon') return null
  return [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]
}

export interface Look {
  /** Обрезка — кусок исходника; нет — картинка целиком (US-0504). */
  readonly crop?: Crop | null
  /** Краска палитры, в которую перекрашен одноцветный принт; нет — исходный. */
  readonly tint?: Ink | null
  /** Непрозрачность 0–1: насколько принт закрывает ткань. Нет — 1. */
  readonly opacity?: number
  /** Замена основных красок многоцветного принта: по строке на каждую
   *  найденную краску; `to` пусто — краска как есть. */
  readonly swaps?: readonly { readonly from: Rgb; readonly to: Ink | null }[]
  /** Дуотон: принт переведён в две–три краски по яркости. */
  readonly duotone?: readonly Ink[] | null
  /** Поворот оттенка, градусы: все цвета сдвигаются вместе. */
  readonly hue?: number
  /** Тон, от −1 до 1: 0 — как в исходнике. */
  readonly saturation?: number
  readonly contrast?: number
  readonly brightness?: number
  readonly warmth?: number
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const d2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
const clamp = (v: number) => Math.min(255, Math.max(0, v))

/** Меняет ли вид сами точки (всё, кроме прозрачности). */
export function changesPixels(look: Look | undefined): boolean {
  if (!look) return false
  return !!(
    look.tint ||
    look.duotone?.length ||
    look.swaps?.some((s) => s.to) ||
    look.hue ||
    look.saturation ||
    look.contrast ||
    look.brightness ||
    look.warmth
  )
}

/**
 * Краски, которые человек объявил у картинки, — по ним и считается число
 * красок. Не угадываются: перекраска в одну, дуотон, замена всех основных
 * красок. Иначе — null: палитра растра не объявлена.
 */
export function declaredInks(look: Look | undefined): string[] | null {
  if (look?.tint) return [look.tint.code]
  if (look?.duotone?.length) return look.duotone.map((i) => i.code)
  if (look?.swaps?.length && look.swaps.every((s) => s.to)) return [...new Set(look.swaps.map((s) => s.to!.code))]
  return null
}

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

/**
 * Основные краски принта — до `max`, с долей: k-средних по непрозрачным
 * точкам, начало — самые далёкие друг от друга, близкие сливаются, крошечные
 * (сглаживание краёв) отбрасываются. Это подсказка для замены, а не число
 * красок: его объявляет человек (declaredInks).
 */
export function mainColours(data: Uint8ClampedArray, max = 4): { rgb: Rgb; share: number }[] {
  const px: Rgb[] = []
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) px.push([data[i], data[i + 1], data[i + 2]])
  if (px.length === 0) return []
  const centres: Rgb[] = [px[0]]
  while (centres.length < max) {
    let best = px[0]
    let far = -1
    for (const p of px) {
      const d = Math.min(...centres.map((c) => d2(c, p)))
      if (d > far) [far, best] = [d, p]
    }
    if (far < 30 ** 2) break
    centres.push(best)
  }
  let counts: number[] = []
  for (let iter = 0; iter < 8; iter++) {
    const sums = centres.map(() => [0, 0, 0])
    counts = centres.map(() => 0)
    for (const p of px) {
      let k = 0
      for (let j = 1; j < centres.length; j++) if (d2(centres[j], p) < d2(centres[k], p)) k = j
      sums[k][0] += p[0]
      sums[k][1] += p[1]
      sums[k][2] += p[2]
      counts[k] += 1
    }
    centres.forEach((_, j) => {
      if (counts[j]) centres[j] = [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]]
    })
  }
  const out: { rgb: Rgb; share: number }[] = []
  centres.forEach((c, j) => {
    const share = counts[j] / px.length
    if (share < 0.03) return
    const same = out.find((o) => d2(o.rgb, c) < 40 ** 2)
    if (same) same.share += share
    else out.push({ rgb: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])], share })
  })
  return out.sort((a, b) => b.share - a.share)
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/**
 * Применить вид к точкам: перекраска в одну краску, дуотон или замена
 * основных красок, потом тон — поворот оттенка, насыщенность, контраст,
 * яркость, теплота. Прозрачность точек не трогается. После перекраски и
 * дуотона тон не применяется: краски объявлены, и сдвиг сделал бы их не
 * красками палитры.
 */
export function applyLook(data: Uint8ClampedArray, look: Look): void {
  if (look.tint) return recolor(data, look.tint.rgb)
  if (look.duotone?.length) {
    const inks = [...look.duotone].sort((a, b) => lum(...a.rgb) - lum(...b.rgb))
    let lo = 255
    let hi = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue
      const l = lum(data[i], data[i + 1], data[i + 2])
      lo = Math.min(lo, l)
      hi = Math.max(hi, l)
    }
    const span = Math.max(1, hi - lo)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue
      const band = Math.min(inks.length - 1, Math.floor(((lum(data[i], data[i + 1], data[i + 2]) - lo) / span) * inks.length))
      const [r, g, b] = inks[band].rgb
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
    }
    return
  }
  const all = look.swaps ?? []
  const swapping = all.some((s) => s.to)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    if (swapping) {
      // Точка относится к ближайшей основной краске; заменена та — сдвиг на
      // разницу красок, полутона внутри неё сохраняются.
      let k = 0
      for (let j = 1; j < all.length; j++) if (d2(all[j].from, [r, g, b]) < d2(all[k].from, [r, g, b])) k = j
      const to = all[k].to
      if (to) {
        r += to.rgb[0] - all[k].from[0]
        g += to.rgb[1] - all[k].from[1]
        b += to.rgb[2] - all[k].from[2]
      }
    }
    if (look.hue || look.saturation) {
      const [h, s, l] = toHsl(clamp(r), clamp(g), clamp(b))
      const nh = (((h + (look.hue ?? 0)) % 360) + 360) % 360
      ;[r, g, b] = fromHsl(nh, Math.min(1, Math.max(0, s * (1 + (look.saturation ?? 0)))), l)
    }
    if (look.contrast) {
      const k = 1 + look.contrast
      r = (r - 128) * k + 128
      g = (g - 128) * k + 128
      b = (b - 128) * k + 128
    }
    if (look.brightness) {
      r += look.brightness * 100
      g += look.brightness * 100
      b += look.brightness * 100
    }
    if (look.warmth) {
      r += look.warmth * 40
      b -= look.warmth * 40
    }
    data[i] = clamp(r)
    data[i + 1] = clamp(g)
    data[i + 2] = clamp(b)
  }
}

const cache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>()

/** Картинка с применённым видом — одна на картинку и набор параметров. */
function looked(img: HTMLImageElement, look: Look): HTMLCanvasElement | null {
  const { opacity: _opacity, crop: _crop, ...pixels } = look
  const key = JSON.stringify(pixels)
  let byLook = cache.get(img)
  if (!byLook) cache.set(img, (byLook = new Map()))
  const hit = byLook.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx || !c.width) return null
  ctx.drawImage(img, 0, 0)
  const px = ctx.getImageData(0, 0, c.width, c.height)
  applyLook(px.data, look)
  ctx.putImageData(px, 0, 0)
  byLook.set(key, c)
  return c
}

/** Основные краски картинки — по уменьшенной копии: сотни точек хватает,
 *  перебирать тысячи незачем. */
export function mainColoursOf(img: HTMLImageElement, max = 4): { rgb: Rgb; share: number }[] {
  const c = document.createElement('canvas')
  const k = Math.min(1, 96 / Math.max(img.naturalWidth, img.naturalHeight))
  c.width = Math.max(1, Math.round(img.naturalWidth * k))
  c.height = Math.max(1, Math.round(img.naturalHeight * k))
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return mainColours(ctx.getImageData(0, 0, c.width, c.height).data, max)
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
  const source = look && changesPixels(look) ? (looked(img, look) ?? img) : img
  const alpha = ctx.globalAlpha
  ctx.globalAlpha = alpha * Math.min(1, Math.max(0, look?.opacity ?? 1))
  const crop = look?.crop
  if (!crop) {
    ctx.drawImage(source, x, y, w, h)
  } else {
    // Кусок исходника на место элемента; фигура — вырезом по рамке.
    const sw = img.naturalWidth
    const sh = img.naturalHeight
    ctx.save()
    if (crop.shape !== 'rect') {
      ctx.beginPath()
      if (crop.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      else {
        const pts = shapePoints(crop.shape) ?? []
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h)))
        ctx.closePath()
      }
      ctx.clip()
    }
    ctx.drawImage(source, crop.x * sw, crop.y * sh, crop.w * sw, crop.h * sh, x, y, w, h)
    ctx.restore()
  }
  ctx.globalAlpha = alpha
}
