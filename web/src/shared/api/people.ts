// Люди приложения и их роли в согласовании (решение 0016): таблица
// «человек — роль» с ФИО ведётся здесь, доступ — платформой.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export type Role = 'designer' | 'editor' | 'chief'

export const ROLE_NAMES: Record<Role, string> = {
  designer: 'дизайнер',
  editor: 'редактор',
  chief: 'главный редактор',
}

export interface Person {
  id: string
  /** ФИО из таблицы ролей; нет — имя из платформы. */
  display_name: string
  full_name: string | null
  role: Role | null
  /** Есть ли сейчас доступ к «Референсу». */
  access: boolean
}

export async function fetchPeople(): Promise<Person[]> {
  const r = await fetch(`${BASE}people`)
  if (!r.ok) throw new Error(`люди не пришли: ${r.status}`)
  return r.json()
}

export async function setRole(id: string, full_name: string, role: Role): Promise<Person> {
  const r = await fetch(`${BASE}people/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name, role }),
  })
  if (!r.ok) throw new Error(r.status === 422 ? ((await r.json()).detail as string) : `роль не записалась: ${r.status}`)
  return r.json()
}

// «Я — …» стенда без платформы (план 075): от чьего имени идут запросы.
// Входа нет, а согласование — работа двоих; сервис принимает заголовок
// только в режиме стенда. Выбор помнит браузер.
const STAND_AS_KEY = 'reference.stand-as'

export function standAs(): string | null {
  try {
    return localStorage.getItem(STAND_AS_KEY)
  } catch {
    return null
  }
}

export function setStandAs(id: string | null): void {
  try {
    if (id) localStorage.setItem(STAND_AS_KEY, id)
    else localStorage.removeItem(STAND_AS_KEY)
  } catch {
    // Без хранилища выбор не запомнится — работать это не мешает.
  }
}

/** Подмешать «я — …» ко всем запросам к сервису. Только для стенда без
 *  платформы: за платформой субъект — из токена, а не из заголовка. */
export function installStandAs(): void {
  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const who = standAs()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!who || !url.includes(BASE)) return original(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set('X-Stand-As', who)
    return original(input, { ...init, headers })
  }
}
