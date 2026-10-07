
import { DEFAULT_PARAMS, type RenderParams } from '../../candidates/renderer'
import { type Composition, type PrintElement } from '../../shared/composition'
import { type Draft } from '../../shared/api/references'
import { detectAlpha } from '../../shared/dropped'
import { type Buffered, type DraftBody } from '../../shared/draftWriter'


/** Работа, как она лежит в версии и в черновике. */
export interface SavedWork {
  stateCode?: string
  colourCode?: string
  size?: number | null
  composition?: Composition
}

/** Какой черновик свежее: браузерная копия (не дошла до сервера) или
 *  серверный (записан с другого компьютера). */
export function newer(server: Draft | null, local: Buffered | null): DraftBody | null {
  if (local && (!server || local.at > Date.parse(server.updated_at))) return local.body
  return server ? { work: server.work, base_number: server.base_number } : null
}

/** Настройки подбора уходят файлом: иначе они испарятся вместе с вкладкой. */
/** Копия холста не больше `size` точек по длинной стороне: снимок для витрины
 *  кодируется мгновенно, а не секунду, как холст отрисовки. */
export function shrink(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const k = Math.min(1, size / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * k))
  c.height = Math.max(1, Math.round(src.height * k))
  c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height)
  return c
}

export function download(params: RenderParams) {
  const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'render-params.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Возврат подобранного. Без него выгрузка бессмысленна: подбор нужен затем,
 *  чтобы к нему вернуться, а не чтобы иметь файл. */
export async function upload(file: File): Promise<RenderParams> {
  const raw = JSON.parse(await file.text()) as Partial<RenderParams>
  return {
    base: raw.base ?? DEFAULT_PARAMS.base,
    baseGamma: Number(raw.baseGamma ?? DEFAULT_PARAMS.baseGamma),
    specCut: Number(raw.specCut ?? DEFAULT_PARAMS.specCut),
    specAmount: Number(raw.specAmount ?? DEFAULT_PARAMS.specAmount),
    through: raw.through ?? DEFAULT_PARAMS.through,
    displace: Number(raw.displace ?? DEFAULT_PARAMS.displace),
    shade: Number(raw.shade ?? DEFAULT_PARAMS.shade),
    shadeGamma: Number(raw.shadeGamma ?? DEFAULT_PARAMS.shadeGamma),
    effects: raw.effects ?? DEFAULT_PARAMS.effects,
  }
}

/** Та же работа — без выбранного: по нему история с полки не отбрасывается. */
export function sameWork(a: Composition, b: Composition): boolean {
  return a === b || JSON.stringify({ ...a, selectedId: null }) === JSON.stringify({ ...b, selectedId: null })
}

/** Пропорция и прозрачность картинки — по уменьшенной пробе. */
export function probeImage(src: string): Promise<{ aspect: number; hasAlpha: boolean }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const w = Math.max(1, Math.min(160, img.naturalWidth))
      const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth))
      const probe = document.createElement('canvas')
      probe.width = w
      probe.height = h
      const ctx = probe.getContext('2d', { willReadFrequently: true })
      ctx?.drawImage(img, 0, 0, w, h)
      resolve({ aspect: img.naturalWidth / img.naturalHeight, hasAlpha: ctx ? detectAlpha(ctx.getImageData(0, 0, w, h).data) : true })
    }
    img.onerror = () => reject(new Error(`картинка не загрузилась: ${src}`))
    img.src = src
  })
}

/** Что сейчас с обрезкой — одной подписью у значка ✂. */
export function cropSummary(el: PrintElement, clipped: boolean): string {
  const names: Record<string, string> = {
    field: 'по печатному полю',
    'zipper-left': 'левее молнии',
    'zipper-right': 'правее молнии',
    seams: 'по боковым швам',
  }
  const parts = []
  if (el.placement.clip) parts.push(clipped ? names[el.placement.clip] ?? el.placement.clip : 'разметки нет')
  const crop = el.kind === 'image' ? el.look?.crop : undefined
  if (crop && (crop.w < 1 || crop.h < 1 || crop.x > 0 || crop.y > 0 || (crop.shape ?? 'rect') !== 'rect')) parts.push('своя')
  return parts.length ? parts.join(' + ') : 'не обрезано'
}
