// Клиент палитры справочника.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface Colour {
  group: string
  code: string
  code_short: string
  name: string
  rgb: [number, number, number]
}

export interface Palette {
  source: string
  exported: string
  colors: Colour[]
}

export async function fetchPalette(): Promise<Palette> {
  const r = await fetch(`${BASE}colours`)
  if (!r.ok) throw new Error(`Палитра: ${r.status}`)
  return (await r.json()) as Palette
}

/** Цвет для шейдера: каналы 0..1. */
export function toUnit(c: Colour): [number, number, number] {
  return [c.rgb[0] / 255, c.rgb[1] / 255, c.rgb[2] / 255]
}

export function toCss(c: Colour): string {
  return `rgb(${c.rgb[0]}, ${c.rgb[1]}, ${c.rgb[2]})`
}
