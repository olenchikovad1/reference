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
  /** Версия сама перед переходом — перед каким (US-0599). Нет — руками. */
  auto_reason?: string | null
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
  /** Для фильтра — от цветомодели (US-0497). */
  drop_ids: number[]
  audience: string | null
  category: string | null
  /** У смотрящего есть несохранённое по карточке (US-0598). */
  my_draft?: boolean
  /** У кого ещё — имена. */
  others_drafts?: string[]
  /** Место в своём порядке витрины (US-0601); нет — не расставлена. */
  my_position?: number | null
  /** Исполнитель (US-0509); нет — сохранён до исполнителей. */
  executor?: Executor | null
  /** Смотрящий — исполнитель: фильтр «мои». */
  mine?: boolean
  /** Статус согласования (US-0510). */
  status?: Status
}

export type Status = 'draft' | 'review' | 'rework' | 'approved' | 'final' | 'rejected'
export type Step = 'submit' | 'recall' | 'return' | 'approve' | 'unapprove' | 'approve-final' | 'reject' | 'revive'

export const STATUS_NAMES: Record<Status, string> = {
  draft: 'черновик',
  review: 'на согласовании',
  rework: 'на доработке',
  approved: 'согласован',
  final: 'окончательно принят',
  rejected: 'забракован',
}

export const STEP_NAMES: Record<Step, string> = {
  submit: 'отправить на согласование',
  recall: 'отозвать',
  return: 'вернуть на доработку',
  approve: 'подтвердить согласование',
  unapprove: 'отменить согласование',
  'approve-final': 'принять окончательно',
  reject: 'забраковать',
  revive: 'вернуть в работу',
}

/** Шаги, которым нужна причина (план 094), — и что спросить в поле. */
export const STEP_ASKS: Partial<Record<Step, string>> = {
  return: 'что поправить',
  unapprove: 'почему отменяете',
  reject: 'почему бракуете',
  revive: 'почему возвращаете',
}

/** Переход статуса: кто, когда, на какой версии, с каким замечанием. */
export interface StatusEvent {
  from: Status
  to: Status
  number: number
  by_id: string | null
  by_name: string | null
  comment: string | null
  at: string
}

/** Сделать шаг согласования; ответ — путь переходов. */
export async function step(referenceId: number, what: Step, comment?: string): Promise<StatusEvent[]> {
  const r = await fetch(`${BASE}references/${referenceId}/${what}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: what in STEP_ASKS ? JSON.stringify({ comment: comment ?? '' }) : undefined,
  })
  if (!r.ok) throw await refusal(r, 'шаг не сделан')
  return r.json()
}

export interface Task {
  id: number
  name: string
  status: Status
  reason: string
}

/** «Мои задачи»: что ждёт меня и что я отдал (US-0510). */
export async function fetchTasks(): Promise<{ mine: Task[]; waiting: Task[] }> {
  const r = await fetch(`${BASE}tasks`)
  if (!r.ok) throw new Error(`задачи не пришли: ${r.status}`)
  return r.json()
}

/** Исполнитель референса: ФИО и есть ли у него доступ. */
export interface Executor {
  id: string
  name: string
  /** Нет доступа — работу надо передать. */
  access: boolean
}

/** Передача работы (US-0509): кто, кому, когда. */
export interface Transfer {
  from_id: string | null
  from_name: string | null
  to_id: string
  to_name: string
  by_id: string | null
  by_name: string | null
  at: string
}

/** Передать работу дизайнеру; ответ — история передач. */
export async function passTo(referenceId: number, subjectId: string): Promise<Transfer[]> {
  const r = await fetch(`${BASE}references/${referenceId}/executor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject_id: subjectId }),
  })
  if (!r.ok) throw await refusal(r, 'не передалось')
  return r.json()
}

/** Черновик между версиями (US-0598): работа целиком и версия, поверх
 *  которой правили. Свой у каждого человека. */
export interface Draft {
  work: unknown
  base_number: number | null
  updated_at: string
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

/** Причина отказа сервиса словами — из его ответа, а не кодом. */
async function refusal(r: Response, what: string): Promise<Error> {
  try {
    const body = (await r.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') return new Error(body.detail)
  } catch {
    // ответ не JSON — остаётся код
  }
  return new Error(`${what}: ${r.status}`)
}

/** Копия последней версии без открытия, с отметкой, от какого пошла. С
 *  дропом — «скопировать в дроп» (US-0501). */
export async function copyReference(id: number, dropId?: number): Promise<Saved> {
  const r = await fetch(`${BASE}references/${id}/copy${dropId ? `?drop_id=${dropId}` : ''}`, { method: 'POST' })
  if (!r.ok) throw await refusal(r, 'копия не вышла')
  return (await r.json()) as Saved
}

/** «Назначить дроп»: референс на цветомодель той же модели в дропе. */
export async function moveToDrop(id: number, dropId: number): Promise<void> {
  const r = await fetch(`${BASE}references/${id}/drop?drop_id=${dropId}`, { method: 'POST' })
  if (!r.ok) throw await refusal(r, 'не назначился')
}
export const trashReference = (id: number) => act('POST', `references/${id}/trash`)
export const restoreReference = (id: number) => act('POST', `references/${id}/restore`)
/** «Удалить насовсем сразу» (US-0499) — мимо корзины, с причиной. */
export async function eraseForever(id: number, reason: string): Promise<void> {
  const r = await fetch(`${BASE}references/${id}/erase-forever`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!r.ok) throw new Error(r.status === 422 ? 'нужна причина' : `не удалилось: ${r.status}`)
}

/** Стереть насовсем — только из корзины и только с функцией её очистки. */
export const eraseReference = (id: number) => act('DELETE', `references/${id}`)
export async function listTrash(): Promise<Trashed[]> {
  const r = await fetch(`${BASE}references/trash`)
  if (!r.ok) throw new Error(`Корзина: ${r.status}`)
  return (await r.json()) as Trashed[]
}

export interface VersionMeta extends Saver {
  number: number
  /** Сделана сама перед переходом — перед каким; нет — сохранил человек. */
  auto_reason?: string | null
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
  /** Свой черновик; пусто — правок поверх версий нет. */
  draft?: Draft | null
  executor?: Executor | null
  transfers?: Transfer[]
  status?: Status
  status_events?: StatusEvent[]
  /** Шаги, доступные смотрящему сейчас; «remark» — ставить замечания. */
  can?: (Step | 'remark')[]
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
  by: 'tag' | 'drop' | 'slogan' | 'picture'
  rank: number
  what: string | null
  /** Все причины по силе: «дроп „Новый год 2027“», «на картинке снег, вес 2.6». */
  reasons: string[]
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

/** Черновик карточки; null — новой, ещё не сохранённой работы. */
const draftPath = (id: number | null) => (id === null ? 'references/drafts/new' : `references/${id}/draft`)

/** Записать черновик. `keepalive` — запрос переживает закрытие страницы:
 *  последняя правка перед уходом не теряется. */
export async function putDraft(
  id: number | null,
  body: { work: unknown; base_number: number | null },
  keepalive = false,
): Promise<void> {
  const r = await fetch(`${BASE}${draftPath(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  })
  if (!r.ok) throw await refusal(r, 'Черновик')
}

/** Отбросить черновик: на экране снова сохранённая версия. */
export async function dropDraft(id: number | null): Promise<void> {
  const r = await fetch(`${BASE}${draftPath(id)}`, { method: 'DELETE' })
  if (!r.ok) throw await refusal(r, 'Черновик')
}

/** Черновик новой работы смотрящего; null — его нет. */
export const newDraft = () => get<Draft | null>('references/drafts/new', 'Черновик')

/** Свой порядок витрины целиком — номера карточек от начала (US-0601). */
export async function setOrder(ids: number[]): Promise<void> {
  const r = await fetch(`${BASE}references/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!r.ok) throw await refusal(r, 'Порядок')
}


/** Замечание (US-0511): на слое или на месте изделия, на версии. */
export interface Remark {
  id: number
  /** Версия, на которой поставлено. */
  number: number
  side: string
  element_id: string | null
  element_name: string | null
  /** Точка метки — доли кадра стороны. */
  x: number
  y: number
  text: string
  author_id: string | null
  author_name: string | null
  status: 'open' | 'fixed' | 'accepted'
  fixed_in: number | null
  created_at: string
  messages: { kind: RemarkSay; text: string | null; author_name: string | null; number: number; at: string }[]
  /** Что смотрящему можно сказать в ветке. */
  can: RemarkSay[]
  /** Голос (US-0512): есть ли запись и где её расшифровка. */
  audio: boolean
  audio_seconds: number | null
  /** Расшифровка как услышано — не правится; правится text. */
  heard: string | null
  voice_status: VoiceStatus | null
  voice_error: string | null
  /** Править текст может только автор. */
  can_edit: boolean
}

export type VoiceStatus = 'pending' | 'working' | 'done' | 'failed'

/** Расшифровка ещё идёт — окно переспрашивает, пока не закончится. */
export const isHearing = (r: Remark) => r.voice_status === 'pending' || r.voice_status === 'working'

export type RemarkSay = 'reply' | 'fixed' | 'accepted' | 'rejected'

export const SAY_NAMES: Record<RemarkSay, string> = {
  reply: 'ответ',
  fixed: 'исправлено',
  accepted: 'принято',
  rejected: 'нет, не то',
}

export async function fetchRemarks(referenceId: number): Promise<Remark[]> {
  const r = await fetch(`${BASE}references/${referenceId}/remarks`)
  if (!r.ok) throw new Error(`замечания не пришли: ${r.status}`)
  return r.json()
}

export async function addRemark(
  referenceId: number,
  body: { side: string; x: number; y: number; text: string; element_id?: string | null },
): Promise<Remark> {
  const r = await fetch(`${BASE}references/${referenceId}/remarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw await refusal(r, 'замечание не поставилось')
  return r.json()
}

export async function sayRemark(referenceId: number, remarkId: number, kind: RemarkSay, text?: string): Promise<Remark> {
  const r = await fetch(`${BASE}references/${referenceId}/remarks/${remarkId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, text: text ?? null }),
  })
  if (!r.ok) throw await refusal(r, 'не записалось')
  return r.json()
}

/** Замечание голосом: запись уходит сразу, расшифровка — в фоне. */
export async function addVoiceRemark(
  referenceId: number,
  where: { side: string; x: number; y: number; element_id?: string | null },
  audio: Blob,
): Promise<Remark> {
  const form = new FormData()
  form.append('audio', audio, 'remark.webm')
  form.append('side', where.side)
  form.append('x', String(where.x))
  form.append('y', String(where.y))
  if (where.element_id) form.append('element_id', where.element_id)
  const r = await fetch(`${BASE}references/${referenceId}/remarks/voice`, { method: 'POST', body: form })
  if (!r.ok) throw await refusal(r, 'запись не сохранилась')
  return r.json()
}

/** Запись замечания — через fetch, а не src у <audio>: за платформой
 *  запрос несёт вход, а голый адрес — нет. */
export async function fetchRemarkAudio(referenceId: number, remarkId: number): Promise<Blob> {
  const r = await fetch(`${BASE}references/${referenceId}/remarks/${remarkId}/audio`)
  if (!r.ok) throw new Error(`запись не пришла: ${r.status}`)
  return r.blob()
}

export async function setRemarkText(referenceId: number, remarkId: number, text: string): Promise<Remark> {
  const r = await fetch(`${BASE}references/${referenceId}/remarks/${remarkId}/text`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) throw await refusal(r, 'текст не поправился')
  return r.json()
}

/** Мой черновик (US-0685): что поменялось против версии, словами, и похоже
 *  ли это на случайное. reference_id пусто — новая работа. */
export interface MyDraft {
  reference_id: number | null
  name: string
  base_number: number | null
  updated_at: string
  changes: string[]
  accidental: boolean
}

export const fetchMyDrafts = () => get<MyDraft[]>('references/drafts/mine', 'Мои черновики')

/** Выбросить все «похоже на случайное»; ответ — номера карточек. */
export async function dropAccidental(): Promise<number[]> {
  const r = await fetch(`${BASE}references/drafts/accidental`, { method: 'DELETE' })
  if (!r.ok) throw await refusal(r, 'Черновики')
  return r.json()
}
