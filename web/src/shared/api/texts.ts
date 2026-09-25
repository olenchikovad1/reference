// Надписи библиотеки (US-0496): из референсов и заведённые заранее.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface TextRow {
  text: string
  fonts: string[]
  /** Референсы с этой надписью — «в скольких» и переход. */
  references: { id: number; name: string }[]
  /** Заведена заранее, в референсах её ещё нет. */
  planned: boolean
  /** При поиске: same — дословно, words — все слова запроса, close — похоже. */
  match: 'same' | 'words' | 'close' | null
  similarity: number | null
}

export async function fetchTexts(q: string): Promise<TextRow[]> {
  const r = await fetch(`${BASE}library/texts${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  if (!r.ok) throw new Error(`тексты не ответили: ${r.status}`)
  return r.json()
}

/** Завести надпись заранее — под будущий дроп. */
export async function planText(text: string): Promise<void> {
  const r = await fetch(`${BASE}library/texts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) throw new Error(`${r.status}`)
}
