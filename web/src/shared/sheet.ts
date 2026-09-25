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

/** Габарит одного элемента с учётом поворота, сантиметры. */
function extent(el: PrintElement): { w: number; h: number } {
  const w = el.placement.widthCm
  const h = heightCm(el)
  const a = (el.placement.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(a))
  const sin = Math.abs(Math.sin(a))
  return { w: w * cos + h * sin, h: w * sin + h * cos }
}

/**
 * Спецификация листа: что напечатано, какого размера и где.
 *
 * Числа здесь — то, что уходит на фабрику. Картинка их только сопровождает.
 */
export function describe(c: Composition): Sheet {
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
    const { w, h } = extent(el)
    x0 = Math.min(x0, el.placement.dxCm - w / 2)
    x1 = Math.max(x1, el.placement.dxCm + w / 2)
    y0 = Math.min(y0, el.placement.dyCm - h / 2)
    y1 = Math.max(y1, el.placement.dyCm + h / 2)
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
): HTMLCanvasElement {
  const sheet = describe(c)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sheet.widthCm * pxPerCm))
  canvas.height = Math.max(1, Math.round(sheet.heightCm * pxPerCm))
  const ctx = canvas.getContext('2d')
  if (!ctx || c.elements.length === 0) return canvas

  let x0 = Infinity
  let y0 = Infinity
  for (const el of c.elements) {
    const { w, h } = extent(el)
    x0 = Math.min(x0, el.placement.dxCm - w / 2)
    y0 = Math.min(y0, el.placement.dyCm - h / 2)
  }

  for (const el of c.elements) {
    const w = el.placement.widthCm * pxPerCm
    const h = heightCm(el) * pxPerCm
    ctx.save()
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
