// Разговор с платформой: кто я, куда я вхож, какие разделы мне открыты.
//
// Приложение не хранит ни субъекта, ни его прав, ни состава меню — оно
// спрашивает платформу (И-5). Своя копия устаревает молча: права отзывают в
// платформе, а приложение продолжает рисовать пункт.
//
// Адрес ядра — от корня сайта, а не от приставки приложения: платформа живёт
// рядом с приложением, а не внутри него. Работает только за шлюзом платформы;
// открытый по своему порту «Референс» ядра не видит — это и есть признак
// «открыт в обход платформы».

import { useQuery } from '@tanstack/react-query'

const CORE = '/platform/api/core'

/** Стенд без платформы (решение 0006) включается явно, в web/.env: платформу
 *  тогда не спрашивают вовсе, прав нет — показывается всё, на экране плашка. */
export const WITHOUT_PLATFORM = import.meta.env.VITE_WITHOUT_PLATFORM === 'true'

export type PlatformApplication = {
  code: string
  name: string
  icon: string
  /** Цвет значка в рельсе — выбран тем, кто подключал приложение. */
  tone?: string
  /** Код первой страницы приложения, а не адрес. */
  home?: string
}

export type PlatformSubsection = { code: string; name: string; icon?: string }

export type PlatformSection = {
  code: string
  name: string
  actions: string[]
  functions: string[]
  icon: string
  tone?: string
  group?: string
  /** Права у подпунктов — вместе с разделом: своих нет. */
  children?: PlatformSubsection[]
}

export type PlatformProfile = {
  id: string
  display_name: string
  email: string
  organization: string
  external: boolean
  avatar: string | null
}

/** Отказ платформы. Пустой список на месте отказа недопустим: он неотличим
 *  от «ничего не открыто», и человек пойдёт искать причину в правах. */
export class PlatformUnavailable extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`платформа ответила ${status} на ${path}`)
  }
}

async function ask<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal })
  if (!r.ok) throw new PlatformUnavailable(r.status, path)
  return (await r.json()) as T
}

// Повторять отказ платформы незачем: 404 от своего порта не пройдёт от того,
// что его спросить трижды, а экран «откройте через платформу» ждал бы повторов.
const once = { retry: false, enabled: !WITHOUT_PLATFORM } as const

/** Приложения, куда человек вхож, — содержимое рельсы. */
export function useApplications() {
  return useQuery<PlatformApplication[]>({
    queryKey: ['platform', 'applications'],
    queryFn: ({ signal }) => ask(`${CORE}/me/applications`, signal),
    ...once,
  })
}

/** Разделы этого приложения, открытые человеку. Меню строится отсюда: раздела
 *  без права в ответе нет вовсе. */
export function useSections(application: string) {
  return useQuery<PlatformSection[]>({
    queryKey: ['platform', 'sections', application],
    queryFn: ({ signal }) => ask(`${CORE}/me/sections?application=${encodeURIComponent(application)}`, signal),
    ...once,
  })
}

/** Кто я. */
export function useProfile() {
  return useQuery<PlatformProfile>({
    queryKey: ['platform', 'me'],
    queryFn: ({ signal }) => ask(`${CORE}/me`, signal),
    ...once,
  })
}

/** Можно ли человеку действие в разделе. Нет права — действия нет и на
 *  экране: кнопка не показывается, а не показывается и отказывает (US-0487).
 *  Пока платформа не ответила — нельзя: мигнуть кнопкой и спрятать хуже. */
export function useCan(application: string, section: string, action: string): boolean {
  const own = useSections(application)
  if (WITHOUT_PLATFORM) return true
  return own.data?.some((s) => s.code === section && s.actions.includes(action)) ?? false
}
