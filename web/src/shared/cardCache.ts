// Карточки референсов в памяти вкладки (US-0600): соседняя по A или D уже
// лежит здесь вместе с картинками, и открытие — это показ, а не загрузка.
//
// Свежесть держится двумя путями. Свой черновик кэш узнаёт сразу — окно пишет
// его сюда же, куда и на сервер: вернулся на карточку — правка на месте. Чужие
// сохранения — сроком: старше STALE_MS карточка перечитывается.
//
// Замер 26.09.2026, стенд, сборка разработки, скрытая панель браузера (там всё
// медленнее, чем в видимой вкладке и в рабочей сборке):
// - соседняя карточка по A/D — 45–117 мс, обычно 50–70; было 100–190 из-за
//   ожидания сети и смены адреса до открытия;
// - открытие с витрины после наведения — 80–144 мс; было 330–870: окно и
//   витрина пересоздавались при каждом открытии, теперь окно живёт скрытым;
// - десять D за две секунды — все карточки показаны, открыта последняя.

import type { QueryClient } from '@tanstack/react-query'

import { openReference, type Draft, type ReferenceFull } from './api/references'
import type { DraftBody } from './draftWriter'
import { warmImage } from './imageCache'

/** Через сколько карточку перечитать: чужая новая версия появится не позже. */
const STALE_MS = 15_000

export const cardKey = (id: number) => ['reference', id] as const

export const cardQuery = (id: number) => ({
  queryKey: cardKey(id),
  queryFn: () => openReference(id),
  staleTime: STALE_MS,
})

/** Порядок карточек на витрине — по нему A и D листают в окне. */
export const ORDER_KEY = ['showcase-order'] as const

/** Картинки работы — греть заранее, чтобы принт лёг с первого кадра. */
function warmWork(work: unknown): void {
  const els = (work as { composition?: { elements?: { kind: string; src?: string }[] } } | null)?.composition?.elements
  for (const el of els ?? []) if (el.kind === 'image' && el.src) warmImage(el.src)
}

/**
 * Карточка сразу — из кэша, даже устаревшая, — и перечитывание в фоне.
 * Ждать сети при каждом A/D нельзя: 20–60 мс на карточку и есть «секунда на
 * четыре карточки». `fresh` зовётся, только если перечитанная отличается
 * номером последней версии — кто-то сохранил, пока мы листали.
 */
export async function cardNow(
  queries: QueryClient,
  id: number,
  fresh: (card: ReferenceFull) => void,
): Promise<ReferenceFull> {
  const cached = queries.getQueryData<ReferenceFull>(cardKey(id))
  if (!cached) return queries.fetchQuery(cardQuery(id))
  const state = queries.getQueryState(cardKey(id))
  if (!state || Date.now() - state.dataUpdatedAt > STALE_MS) {
    void queries
      .fetchQuery({ ...cardQuery(id), staleTime: 0 })
      .then((card) => {
        if (card.number !== cached.number) fresh(card)
      })
      .catch(() => undefined)
  }
  return cached
}

/** Подготовить карточку: данные и картинки. Ошибку глотает — это заготовка,
 *  не открытие; откроется карточка своим путём и скажет, что не так. */
export function prefetchCard(queries: QueryClient, id: number): void {
  void queries
    .fetchQuery(cardQuery(id))
    .then((card) => {
      warmWork(card.draft?.work ?? card.work)
    })
    .catch(() => undefined)
}

/** Свой черновик — в кэш карточки сразу, не дожидаясь перечитывания. */
export function rememberDraft(queries: QueryClient, id: number, body: DraftBody | null): void {
  queries.setQueryData<ReferenceFull>(cardKey(id), (card) => {
    if (!card) return card
    const draft: Draft | null = body
      ? { work: body.work, base_number: body.base_number, updated_at: new Date().toISOString() }
      : null
    return { ...card, draft }
  })
}
