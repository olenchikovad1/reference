// Разработка коллекции (решение 0020): коллекция — релиз PLM, база — его
// модель, колонка — цветомодель, под ней варианты с метками. Каталог PLM
// приходит через сервис (ключ машинного входа остаётся там, решение 0018).

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface CollectionRow {
  id: string
  code: string
  active: boolean
  drop_code: string | null
  supplier: string | null
  colorways: number
  variants: number
}

export interface TeamMember {
  role: string
  name: string
}

export interface Collection {
  id: string
  code: string
  name_ru: string | null
  drop_code: string | null
  brand: string | null
  gender: string | null
  supplier: string | null
  product: string | null
  team: TeamMember[]
  plm_path: string
}

/** Сторона базы: ключ картинки PLM; `exact` — рендер этой стороны, а не
 *  главная картинка цветомодели вместо него. */
export interface BaseView {
  key: string
  article: string | null
  exact: boolean
}

export interface Variant {
  id: number
  name: string
  number: number
  /** Хеш картинки в хранилище «Референса»: ступени thumb и preview. */
  image: string
  author_id: string | null
  author: string | null
  created_at: string
  saved_at: string
  label_id: number | null
  /** Кто и когда поставил метку — ночная правка видна утром с именем. */
  label_by: string | null
  label_at: string | null
  /** На полке «Отложено» с этого момента; пусто — в работе. */
  shelved_at: string | null
  is_new: boolean
}

export interface Colour {
  colorway_id: string
  article: string
  color: string | null
  color_code: string | null
  base_color: string | null
  rgb: number[] | null
  image: string | null
  variants: Variant[]
}

export interface Base {
  style_id: string
  code: string
  name: string | null
  category: string | null
  gender: string | null
  size_range: string | null
  views: { front: BaseView | null; back: BaseView | null }
  /** «Идеи» базы — без цвета, их переносят в колонку цвета. */
  ideas: Variant[]
  colours: Colour[]
  /** Полка «Отложено» — подвал вместо удаления. */
  shelf: Variant[]
}

export interface Board {
  /** Кто смотрит — для отбора «мои». */
  viewer: string | null
  collection: Collection
  bases: Base[]
}

export interface Label {
  id: number
  name: string
  tone: string
  position: number
  active: boolean
}

async function readFailure(r: Response): Promise<Error> {
  let text = `сервис ответил ${r.status}`
  try {
    const body = await r.json()
    const detail = body?.detail
    text = detail?.message ?? detail?.reason ?? (typeof detail === 'string' ? detail : text)
  } catch {
    /* текст отказа уже есть */
  }
  return new Error(text)
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, init)
  if (!r.ok) throw await readFailure(r)
  return (r.status === 204 ? undefined : await r.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const fetchCollections = (q: string) =>
  call<{ items: CollectionRow[] }>(`collections${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((b) => b.items)

export const fetchBoard = (releaseId: string) => call<Board>(`collections/${encodeURIComponent(releaseId)}`)

export const fetchLabels = () => call<Label[]>('collections/labels')

export const addLabel = (name: string, tone: string) => call<Label>('collections/labels', json('POST', { name, tone }))

export const changeLabel = (id: number, patch: Partial<Pick<Label, 'name' | 'tone' | 'active' | 'position'>>) =>
  call<Label>(`collections/labels/${id}`, json('PATCH', patch))

export const setVariantLabel = (variantId: number, labelId: number | null) =>
  call<void>(`collections/variants/${variantId}/label`, json('PUT', { label_id: labelId }))

export const markSeen = (variantId: number) => call<void>(`collections/variants/${variantId}/seen`, { method: 'POST' })

/** Картинки в колонку цвета (или в «Идеи» базы, цвета нет): каждая — свой вариант. */
export function uploadVariants(releaseId: string, styleId: string, colorwayId: string | null, files: File[]) {
  const form = new FormData()
  form.append('style_id', styleId)
  if (colorwayId) form.append('colorway_id', colorwayId)
  for (const f of files) form.append('files', f, f.name || 'вставка.png')
  return call<{ id: number; number: number; name: string; image: string }[]>(
    `collections/${encodeURIComponent(releaseId)}/variants`,
    { method: 'POST', body: form },
  )
}

/** Колонка в новом порядке; перенесённые едут со всеми данными. */
export const placeVariants = (releaseId: string, styleId: string, colorwayId: string | null, ids: number[]) =>
  call<void>(
    `collections/${encodeURIComponent(releaseId)}/place`,
    json('PUT', { style_id: styleId, colorway_id: colorwayId, ids }),
  )

export const shelveVariant = (variantId: number, shelved: boolean) =>
  call<void>(`collections/variants/${variantId}/shelf`, json('PUT', { shelved }))
