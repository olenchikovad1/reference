// Каталог hub PLM через BFF Референса (US-0883, US-0886, решение 0018).
// Браузер plm напрямую не зовёт — ключ машинного входа остаётся на сервисе.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface PlmStatus {
  configured: boolean
  reachable: boolean
  drops: number
  message: string
}

export interface PlmDrop {
  code: string
  season: string | null
  subseason: string | null
  category: string | null
  description: string | null
  ship_week_uz: number | null
  ship_week_cn: number | null
  intake_week: number | null
  exit_week: number | null
  active: boolean
  position: number
}

export interface PlmColorway {
  id: string
  article: string
  title: string
  style_id: string
  style_code: string
  color: string | null
  base_color: string | null
  rgb: number[] | null
  gender: string | null
  image: string | null
  suppliers: string[]
  product_code: string | null
  can_work: boolean
  reason: string | null
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path)
  if (!r.ok) {
    let detail = `plm не ответил: ${r.status}`
    try {
      const body = await r.json()
      detail = body?.detail?.message ?? body?.detail ?? detail
    } catch {
      /* текст отказа уже в detail */
    }
    throw new Error(typeof detail === 'string' ? detail : `plm не ответил: ${r.status}`)
  }
  return r.json()
}

export const fetchPlmStatus = () => get<PlmStatus>('plm/status')
export const fetchPlmDrops = (activeOnly = true) =>
  get<{ items: PlmDrop[] }>(`plm/drops?active_only=${activeOnly}`).then((b) => b.items)
export const fetchPlmColorways = (drop?: string) =>
  get<{ items: PlmColorway[] }>(`plm/colorways${drop ? `?drop=${encodeURIComponent(drop)}` : ''}`).then(
    (b) => b.items,
  )

export function rgbCss(rgb: number[] | null | undefined): string | undefined {
  if (!rgb || rgb.length !== 3) return undefined
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

/** Thumb/preview через BFF — оригинал в браузер не уходит (И-3, US-0887). */
export function plmImageUrl(imageKey: string | null | undefined, preset: 'thumb' | 'preview' = 'thumb'): string | null {
  if (!imageKey) return null
  return `${BASE}plm/images/${encodeURIComponent(imageKey)}/${preset}`
}
