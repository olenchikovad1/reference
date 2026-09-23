// Клиент файлов.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface Derivative {
  name: string
  width: number
  height: number
  /** Ступень оказалась копией оригинала: он был мельче. */
  is_copy: boolean
}

export interface Asset {
  digest: string
  name: string
  content_type: string
  width: number
  height: number
  derivatives: Derivative[]
  reused: boolean
}

export async function uploadAssets(files: File[]): Promise<Asset[]> {
  const body = new FormData()
  // Несколько файлов одной операцией: по одному — та же работа, ради
  // устранения которой всё затевалось.
  for (const f of files) body.append('files', f)
  const r = await fetch(`${BASE}assets`, { method: 'POST', body })
  if (!r.ok) throw new Error(`Загрузка: ${r.status}`)
  return (await r.json()) as Asset[]
}

/** Адрес ступени. Оригинал этим путём не отдаётся и в браузер не уходит. */
export function assetUrl(digest: string, preset: 'thumb' | 'preview'): string {
  return `${BASE}assets/${digest}/${preset}`
}
