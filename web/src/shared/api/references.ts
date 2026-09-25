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
  /** Снимки изделия по сторонам для витрины: код стороны → файл. */
  views?: Record<string, string>
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
  /** Снимки последней версии по сторонам; пусто — сохранена до витрины. */
  views: Record<string, string>
  /** Цвет изделия и дропы цветомодели; пусто — без цветомодели. */
  colour_code: string | null
  drops: string[]
  /** От какого референса пошла копия; пусто — начат с чистого листа. */
  forked_from_id: number | null
}

/** Референс в корзине: когда удалён и когда сотрётся сам (решение 0014). */
export interface Trashed extends Card {
  deleted_at: string
  purge_at: string
}

async function act(method: string, path: string): Promise<void> {
  const r = await fetch(`${BASE}${path}`, { method })
  if (!r.ok) throw new Error(r.status === 409 ? 'Сначала в корзину' : `Не вышло: ${r.status}`)
}

/** Копия последней версии без открытия, с отметкой, от какого пошла. */
export async function copyReference(id: number): Promise<Saved> {
  const r = await fetch(`${BASE}references/${id}/copy`, { method: 'POST' })
  if (!r.ok) throw new Error(`Копия не вышла: ${r.status}`)
  return (await r.json()) as Saved
}
export const trashReference = (id: number) => act('POST', `references/${id}/trash`)
export const restoreReference = (id: number) => act('POST', `references/${id}/restore`)
/** Стереть насовсем — только из корзины и только с функцией её очистки. */
export const eraseReference = (id: number) => act('DELETE', `references/${id}`)
export async function listTrash(): Promise<Trashed[]> {
  const r = await fetch(`${BASE}references/trash`)
  if (!r.ok) throw new Error(`Корзина: ${r.status}`)
  return (await r.json()) as Trashed[]
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
  tags: RefTags
}

/** Свои теги референса и скрытые у него автотеги (US-0493). */
export interface RefTags {
  own: string[]
  hidden: { code: string; name: string }[]
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Теги: ${r.status}`)
  return (await r.json()) as T
}

export const addTag = (id: number, name: string) => send<RefTags>('POST', `references/${id}/tags`, { name })
export const removeTag = (id: number, name: string) =>
  send<RefTags>('DELETE', `references/${id}/tags?name=${encodeURIComponent(name)}`)
export const hideTag = (id: number, code: string, name: string) =>
  send<RefTags>('POST', `references/${id}/hidden-tags`, { code, name })
export const unhideTag = (id: number, code: string) =>
  send<RefTags>('DELETE', `references/${id}/hidden-tags?code=${encodeURIComponent(code)}`)
/** Уже заведённые свои теги — подсказка при вводе. */
export const tagNames = (prefix: string) => send<string[]>('GET', `references/tag-names?prefix=${encodeURIComponent(prefix)}`)

/** Найденный референс: свой тег первым, надпись дословно, картинка по смыслу. */
export interface FoundReference {
  id: number
  name: string
  by: 'tag' | 'slogan' | 'picture'
  rank: number
  what: string | null
}

export const findReferences = (q: string) => send<FoundReference[]>('GET', `references/find?q=${encodeURIComponent(q)}`)

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
