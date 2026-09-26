// Плоский печатный лист: то, что уходит на фабрику.
//
// Собирается из тех же сантиметров, что и показ, но МИНУЯ карты смещения и
// света. Складок в нём не может быть по устройству, а не по договорённости:
// шейдер сюда просто не зовётся. Это и снимает главный страх — «на фабрику
// уйдёт не то, что утвердили».
//
// Отсюда же следствие, ради которого лист и делается рано: качество мокапа на
// печатный файл не влияет никак. Можно выключить показ целиком, и лист выйдет
// тем же.

import { drawLooked } from './look'
import type { Composition, PrintElement } from './composition'
import { heightCm } from './composition'
import { drawText } from './text'

/** Контуры обрезки по разметке (US-0505): id элемента → многоугольник в см
 *  от ориентира элемента, как смещение. Строит их zones.clipOutline. */
export type Clips = ReadonlyMap<string, readonly (readonly [number, number])[]>

export interface SheetItem {
  readonly name: string
  readonly widthCm: number
  readonly heightCm: number
  readonly anchor: string
  readonly dxCm: number
  readonly dyCm: number
  readonly rotation: number
}

export interface Sheet {
  /** Габарит всего напечатанного, сантиметры. */
  readonly widthCm: number
  readonly heightCm: number
  readonly items: readonly SheetItem[]
}

/** Габарит одного элемента с учётом поворота и обрезки по разметке, см от
 *  ориентира. Обрезанный по полю лист не шире поля. */
function box(el: PrintElement, clips?: Clips): { x0: number; y0: number; x1: number; y1: number } {
  const w = el.placement.widthCm
  const h = heightCm(el)
  const a = (el.placement.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(a))
  const sin = Math.abs(Math.sin(a))
  const ew = w * cos + h * sin
  const eh = w * sin + h * cos
  const b = {
    x0: el.placement.dxCm - ew / 2,
    x1: el.placement.dxCm + ew / 2,
    y0: el.placement.dyCm - eh / 2,
    y1: el.placement.dyCm + eh / 2,
  }
  const clip = clips?.get(el.id)
  if (!clip || clip.length < 3) return b
  const xs = clip.map((p) => p[0])
  const ys = clip.map((p) => p[1])
  const c = {
    x0: Math.max(b.x0, Math.min(...xs)),
    x1: Math.min(b.x1, Math.max(...xs)),
    y0: Math.max(b.y0, Math.min(...ys)),
    y1: Math.min(b.y1, Math.max(...ys)),
  }
  // Обрезано целиком — габарит нулевой в центре, а не вывернутый.
  return c.x1 > c.x0 && c.y1 > c.y0 ? c : { x0: el.placement.dxCm, x1: el.placement.dxCm, y0: el.placement.dyCm, y1: el.placement.dyCm }
}

/**
 * Спецификация листа: что напечатано, какого размера и где.
 *
 * Числа здесь — то, что уходит на фабрику. Картинка их только сопровождает.
 */
export function describe(c: Composition, clips?: Clips): Sheet {
  const items = c.elements.map<SheetItem>((el) => ({
    name: el.kind === 'text' ? el.text : el.name,
    widthCm: el.placement.widthCm,
    heightCm: heightCm(el),
    anchor: el.placement.anchor,
    dxCm: el.placement.dxCm,
    dyCm: el.placement.dyCm,
    rotation: el.placement.rotation,
  }))
  if (items.length === 0) return { widthCm: 0, heightCm: 0, items }

  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const el of c.elements) {
    const b = box(el, clips)
    x0 = Math.min(x0, b.x0)
    x1 = Math.max(x1, b.x1)
    y0 = Math.min(y0, b.y0)
    y1 = Math.max(y1, b.y1)
  }
  return { widthCm: x1 - x0, heightCm: y1 - y0, items }
}

/**
 * Рисует лист в холст печатного разрешения.
 *
 * Разрешение задаётся числом пикселей на сантиметр — тем же языком, что и всё
 * остальное. Экранных пикселей здесь нет вовсе: лист годится к отправке, а не
 * к показу.
 */
export function render(
  c: Composition,
  images: ReadonlyMap<string, HTMLImageElement>,
  pxPerCm: number,
  clips?: Clips,
): HTMLCanvasElement {
  const sheet = describe(c, clips)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sheet.widthCm * pxPerCm))
  canvas.height = Math.max(1, Math.round(sheet.heightCm * pxPerCm))
  const ctx = canvas.getContext('2d')
  if (!ctx || c.elements.length === 0) return canvas

  let x0 = Infinity
  let y0 = Infinity
  for (const el of c.elements) {
    const b = box(el, clips)
    x0 = Math.min(x0, b.x0)
    y0 = Math.min(y0, b.y0)
  }

  for (const el of c.elements) {
    const w = el.placement.widthCm * pxPerCm
    const h = heightCm(el) * pxPerCm
    ctx.save()
    // Обрезка по разметке — тем же контуром, что на экране (US-0505).
    const clip = clips?.get(el.id)
    if (clip && clip.length >= 3) {
      ctx.beginPath()
      clip.forEach(([x, y], i) => {
        const px = (x - x0) * pxPerCm
        const py = (y - y0) * pxPerCm
        if (i) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      })
      ctx.closePath()
      ctx.clip()
    }
    ctx.translate((el.placement.dxCm - x0) * pxPerCm, (el.placement.dyCm - y0) * pxPerCm)
    ctx.rotate((el.placement.rotation * Math.PI) / 180)
    if (el.kind === 'text') {
      drawText(ctx, el, w)
    } else {
      const img = images.get(el.src)
      // С видом элемента: на фабрику уходит перекрашенное и полупрозрачное
      // ровно так, как утвердили на экране (US-0502).
      if (img?.complete) drawLooked(ctx, img, el.look, -w / 2, -h / 2, w, h)
    }
    ctx.restore()
  }
  return canvas
}
