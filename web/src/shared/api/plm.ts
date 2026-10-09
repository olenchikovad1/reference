// Каталог hub PLM через BFF Референса (US-0883, US-0886, решение 0018).
// Браузер plm напрямую не зовёт — ключ машинного входа остаётся на сервисе.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface PlmStatus {
  configured: boolean
  reachable: boolean
  drops: number
  message: string
  web_url?: string | null
}

export type PlmReadiness = 'none' | 'partial' | 'full'

export interface PlmPassport {
  id: string
  article: string
  title: string | null
  style_id: string
  style_code: string
  style_name: string | null
  brand: string | null
  category: string | null
  color: string | null
  color_code: string | null
  gender: string | null
  drop_code: string | null
  size_range: string | null
  suppliers: string[]
  readiness: Record<string, PlmReadiness>
  plm_path: string
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
export const fetchPlmPassport = (colorwayId: string) => get<PlmPassport>(`plm/colorways/${encodeURIComponent(colorwayId)}`)

const READINESS_LABEL: Record<string, string> = {
  size_charts: 'табель мер',
  patterns: 'лекала',
  technology: 'технология',
  boms: 'БОМ',
}
const READINESS_STATE: Record<PlmReadiness, string> = {
  none: 'нет',
  partial: 'в работе',
  full: 'есть',
}

export function readinessLines(marks: Record<string, PlmReadiness> | undefined): { label: string; state: string }[] {
  return Object.entries(READINESS_LABEL).map(([key, label]) => ({
    label,
    state: READINESS_STATE[marks?.[key] ?? 'none'],
  }))
}

export function plmOpenUrl(webUrl: string | null | undefined, path: string | null | undefined): string | null {
  if (!path) return null
  if (!webUrl) return path
  return `${webUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export function rgbCss(rgb: number[] | null | undefined): string | undefined {
  if (!rgb || rgb.length !== 3) return undefined
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

/** Thumb/preview через BFF — оригинал в браузер не уходит (И-3, US-0887). */
export function plmImageUrl(imageKey: string | null | undefined, preset: 'thumb' | 'preview' = 'thumb'): string | null {
  if (!imageKey) return null
  return `${BASE}plm/images/${encodeURIComponent(imageKey)}/${preset}`
}
