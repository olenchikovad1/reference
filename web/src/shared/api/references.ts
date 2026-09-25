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
  /** Номер референса. */
  id: number
  /** Номер сохранённой версии внутри референса. */
  number: number
  matches: ReferenceMatch[]
}

export interface VersionBody {
  name: string
  sheet_digest: string
  image_digests: string[]
  texts: string[]
  /** Работа целиком: без неё версия — снимок для узнавания, открыть
   *  который нечем. */
  work?: unknown
}

async function post(path: string, body: unknown): Promise<Saved> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Сохранение: ${r.status}`)
  return (await r.json()) as Saved
}

/** Новый референс с первой версией. С forked_from — «Сохранить как». */
export function saveReference(
  body: VersionBody & {
    /** Цветомодель, на которой референс (US-0489). */
    colour_model_id?: number | null
    forked_from?: { reference_id: number; number: number } | null
  },
): Promise<Saved> {
  return post('references', body)
}

/** «Сохранить»: новая версия поверх последней, прежние не меняются. */
export function saveVersion(referenceId: number, body: VersionBody): Promise<Saved> {
  return post(`references/${referenceId}/versions`, body)
}

/** Точный поиск по надписи. Именно точный — «где мы писали ЛЕТО 2025». */
export async function searchReferences(q: string): Promise<{ id: number; name: string }[]> {
  const r = await fetch(`${BASE}references/search?q=${encodeURIComponent(q)}`)
  if (!r.ok) throw new Error(`Поиск: ${r.status}`)
  return await r.json()
}

/** Кто и когда сохранил версию. */
export interface Saver {
  saved_at: string
  author_id: string | null
  /** Имя из снимка людей платформы; пусто — имя ещё не приходило. */
  author_name: string | null
}

/** Референс в списке: имя и номер последней версии. */
export interface Card extends Saver {
  id: number
  name: string
  number: number
}

export interface VersionMeta extends Saver {
  number: number
}

export interface ReferenceFull {
  id: number
  name: string
  colour_model_id: number | null
  /** От какой версии пошёл («Сохранить как»); пусто — с чистого листа. */
  forked_from: { reference_id: number; number: number; name: string } | null
  versions: VersionMeta[]
  /** Номер и работа последней версии. */
  number: number
  work: unknown
}

async function get<T>(path: string, what: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${what}: ${r.status}`)
  return (await r.json()) as T
}

/** Референсы, свежие по последней версии первыми. */
export const listReferences = () => get<Card[]>('references', 'Список')

/** Референс с версиями и работой последней. work пусто — сохранена до того,
 *  как работу начали хранить. */
export const openReference = (id: number) => get<ReferenceFull>(`references/${id}`, 'Открыть')

/** Версия целиком — листание истории открывает её. */
export const openVersion = (id: number, number: number) =>
  get<VersionMeta & { work: unknown }>(`references/${id}/versions/${number}`, 'Версия')
