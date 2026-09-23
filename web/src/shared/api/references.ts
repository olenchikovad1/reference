// Собранный принт: сохранение и точный поиск по надписи.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface ReferenceMatch {
  /** По чему совпало: picture — рисунок, slogan — надпись, print — лист целиком.
   *  Голое число похожести ни о чём не говорит: «совпал рисунок» и «совпал
   *  принт целиком» — разные выводы. */
  by: 'picture' | 'slogan' | 'print'
  reference_id: number
  name: string
  similarity: number
  /** same — совпало точно; close — похоже, повод посмотреть прошлое. */
  level: 'same' | 'close'
  /** Надпись, если совпало по ней. */
  text: string | null
}

export interface Saved {
  id: number
  matches: ReferenceMatch[]
}

export async function saveReference(body: {
  name: string
  sheet_digest: string
  image_digests: string[]
  texts: string[]
}): Promise<Saved> {
  const r = await fetch(`${BASE}references`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Сохранение: ${r.status}`)
  return (await r.json()) as Saved
}

/** Точный поиск по надписи. Именно точный — «где мы писали ЛЕТО 2025». */
export async function searchReferences(q: string): Promise<{ id: number; name: string }[]> {
  const r = await fetch(`${BASE}references/search?q=${encodeURIComponent(q)}`)
  if (!r.ok) throw new Error(`Поиск: ${r.status}`)
  return await r.json()
}
