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

export interface Match {
  digest: string
  name: string
  similarity: number
  /** file — тот же ФАЙЛ, поймал хеш (мгновенно, без модели);
   *  same — та же КАРТИНКА, поймал вектор: файл другой, рисунок тот же;
   *  close — похожая по теме.
   *  Три случая, а не один: выводы из них разные, и сети разные. */
  level: 'file' | 'same' | 'close'
}

export interface Recognised {
  digest: string
  matches: Match[]
}

/** Узнавание. Отдельным запросом: модель считает около 90 мс на картинку, и
 * внутри загрузки это секунда ожидания на десятке файлов. Вызывающий этот
 * запрос НЕ ждёт — картинки уже на изделии, окно придёт, когда придёт. */
export async function recogniseAssets(digests: string[]): Promise<Recognised[]> {
  const r = await fetch(`${BASE}assets/recognise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(digests),
  })
  if (!r.ok) throw new Error(`Узнавание: ${r.status}`)
  return (await r.json()) as Recognised[]
}
