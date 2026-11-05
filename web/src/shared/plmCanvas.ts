import type { Composition, PrintElement } from './composition'
import type { Product } from './api/products'
import { fetchPlmPassport, plmImageUrl, type PlmImage } from './api/plm'

export const PLM_CANVAS_EDGE = 1024
export const plmCanvasCode = (id: string): string => `PLM-CANVAS-${id}`
export const isCanvasCode = (code: string): boolean => code.startsWith('PLM-CANVAS-')

/** Один квадрат для любых пропорций исходника; свободное место остаётся полем. */
export function fitCanvasImage(width: number, height: number) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('У изображения нет размера')
  const scale = PLM_CANVAS_EDGE / Math.max(width, height)
  return { x: (PLM_CANVAS_EDGE - width * scale) / 2, y: (PLM_CANVAS_EDGE - height * scale) / 2,
    width: width * scale, height: height * scale }
}

export function canvasViews(images: readonly PlmImage[]) {
  const used = new Set<string>()
  const keys = new Set<string>()
  const real = images.filter(i => {
    if (!i.key || keys.has(i.key) || /GeneratedColoredImage/i.test(i.name ?? '')) return false
    keys.add(i.key)
    return true
  })
  const hasFront = real.some(i => /front|перед/i.test(`${i.side ?? ''} ${i.name ?? ''}`))
  const views = real.map((image, index) => {
    const name = `${image.side ?? ''} ${image.name ?? ''}`.toLowerCase()
    const side = /front|перед/.test(name) ? 'front' : /back|спин|зад/.test(name) ? 'back'
      : /left|лев/.test(name) ? 'left' : /right|прав/.test(name) ? 'right'
      : index === 0 && !hasFront ? 'front' : `view-${index + 1}`
    const code = used.has(side) ? `${side}-${index + 1}` : side
    used.add(code)
    return { code, image, label: ({ front: 'Перед', back: 'Спина', left: 'Слева', right: 'Справа' } as Record<string, string>)[code]
      ?? image.name ?? `Ракурс ${index + 1}` }
  })
  const order = ['front', 'back', 'left', 'right']
  return views.sort((a, b) => (order.includes(a.code) ? order.indexOf(a.code) : 10) - (order.includes(b.code) ? order.indexOf(b.code) : 10))
}

async function normalizedFrame(key: string): Promise<string> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { image.src = ''; reject(new Error('Изображение PLM не ответило. Повторите чтение.')) }, 20_000)
    image.onload = () => { clearTimeout(timer); resolve() }
    image.onerror = () => { clearTimeout(timer); reject(new Error('Изображение PLM не загрузилось. Повторите чтение.')) }
    image.src = plmImageUrl(key, 'preview')!
  })
  const fit = fitCanvasImage(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = PLM_CANVAS_EDGE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Браузер не открыл холст')
  context.drawImage(image, fit.x, fit.y, fit.width, fit.height)
  return canvas.toDataURL('image/png')
}

/** Адаптер существующего редактора. Внутренняя шкала 0–100 — доли холста,
 *  не мерки одежды; в work v3 поля с суффиксом Cm никогда не записываются. */
export async function fetchCanvasProduct(code: string): Promise<Product> {
  const passport = await fetchPlmPassport(code.slice('PLM-CANVAS-'.length))
  const views = canvasViews(passport.images ?? [])
  if (!views.length) throw new Error('PLM не передал ракурсы этой модели. Выберите другую или повторите чтение.')
  const states = await Promise.all(views.map(async view => ({ code: view.code, display_name: view.label,
    kind: 'canvas' as const, hood: null, zipper: null,
    frame: { width: PLM_CANVAS_EDGE, height: PLM_CANVAS_EDGE, sha256: view.image.key, src: await normalizedFrame(view.image.key) },
    silhouette: {}, anchors: { centre: [512, 512] as [number, number], neck: [512, 512] as [number, number] }, zones: {}, lines: {}, defects: [] })))
  return { code, display_name: passport.article, kind: passport.category ?? 'PLM', coordinate_space: 'canvas',
    size_set: { name: '', sizes: [], simulated: [] }, rendered_size: null, rendered_size_assumed: null,
    calibration: { px_per_cm: PLM_CANVAS_EDGE / 100, provisional: false, projection: 'canvas', derived_from: null,
      range_if_size_unknown: null, note: '100 единиц — ширина холста; физической калибровки нет' },
    states, states_absent: [], print_fields: null, print_rules: null, size_grid: null,
    checks: { print_field: false, hood: false }, torso: null }
}

type CanvasPlacement = { side: string; anchor: string; x: number; y: number; width: number; rotation: number }
type CanvasElement = (Omit<Extract<PrintElement, { kind: 'image' }>, 'placement'> | Omit<Extract<PrintElement, { kind: 'text' }>, 'placement'>) & { placement: CanvasPlacement }
export interface CanvasComposition { elements: CanvasElement[]; selectedId: null }

export function encodeCanvasComposition(composition: Composition): CanvasComposition {
  return { selectedId: null, elements: composition.elements.map(element => ({ ...element, placement: {
    side: element.placement.side, anchor: element.placement.anchor,
    x: element.placement.dxCm, y: element.placement.dyCm, width: element.placement.widthCm, rotation: element.placement.rotation,
  } })) }
}
export function decodeCanvasComposition(composition: CanvasComposition): Composition {
  return { selectedId: null, elements: composition.elements.map(element => ({ ...element, placement: {
    side: element.placement.side, anchor: element.placement.anchor,
    dxCm: element.placement.x, dyCm: element.placement.y, widthCm: element.placement.width, rotation: element.placement.rotation,
  } })) }
}
