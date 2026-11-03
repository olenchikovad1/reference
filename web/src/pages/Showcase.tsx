// Витрина референсов (US-0491): работы карточками — изделие спереди и сзади,
// а не список имён. Три строки при любой высоте окна, столбцов — сколько
// помещается, остальное листается вбок. Первая карточка — «+»: новый референс
// начинается отсюда, выбором изделия и цвета.
//
// Картинки карточек — снимки, сделанные при сохранении (views версии), а не
// отрисовка на лету: шестьдесят карточек не должны рисовать сто двадцать
// изделий.

import { EmptyState, IconButton, Modal, PageHeader, Select, Spinner, TextInput, buttonClass } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { CODE } from '../app/shell'
import { DropFilterBar } from '../candidates/DropFilter'
import { useFlip } from '../candidates/useFlip'
import { useTileWindow } from '../candidates/useTileWindow'
import { ThumbnailProgress } from '../candidates/ThumbnailProgress'
import { meaningClass } from '../candidates/meaning'
import { FamilyPopup } from '../candidates/FamilyPopup'
import { ReviewDecisionModal } from '../candidates/ReviewDecisionModal'
import { PlmModelImage } from '../candidates/PlmModelImage'
import { ReferenceCard as ShowcaseCard } from '../candidates/ReferenceCard'
import { HotkeysHint } from '../candidates/HotkeysHint'
import { SHOWCASE_KEYS } from '../shared/keys'
import { moveTo, ownOrder, placeOf, preview } from '../shared/order'
import { SEASON_NAMES, useDropFilter, type SeasonFilter } from '../shared/filters'
import { fullOwnOrder, patchReferencePositions, useReferenceFeed, useShowcaseOptions } from '../shared/referenceFeed'
import { fetchPeople } from '../shared/api/people'
import { useCan } from '../shared/api/platform'

import { ORDER_KEY, prefetchCard } from '../shared/cardCache'
import { fetchPalette, toCss } from '../shared/api/colours'
import { fetchCatalogue, type TreeNode } from '../shared/api/drops'
import {
  copyReference,
  eraseForever,
  moveToDrop,
  setOrder,
  restoreReference,
  STATUS_NAMES,
  trashReference,
  type Card,
  type Status,
} from '../shared/api/references'
import { fetchDrops, type Drop } from '../shared/api/drops'
import { fetchPlmColorways, fetchPlmDrops, fetchPlmStatus, colorwayColourCode, rgbCss, type PlmColorway, type PlmDrop } from '../shared/api/plm'
import {
  profileFromDates,
  profileFromWeeks,
  untilDateLabel,
  untilWeekLabel,
} from '../shared/season'

/** На экран помещается три ряда карточек при любой высоте окна; дальше —
 *  колесом вниз (US-0721, владелец 29.09: «людям привычнее колёсиком»). */
const ROWS = 3
const GAP = 12
/** Ширина карточки к высоте: изделие почти квадратное, плюс подпись снизу. */
const ASPECT = 0.8

export function Showcase() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const drop = useDropFilter()
  const { query, setQuery, asked, sortOwn, setSortOwn, onlyMine, setOnlyMine, onlyDrafts, setOnlyDrafts } = useShowcaseOptions()
  const feedFilters = useMemo(() => ({
    q: asked, drop: drop.filter.drop, audience: drop.filter.audience, category: drop.filter.category,
    status: drop.filter.status, executor: drop.filter.executor, my_turn: drop.filter.myTurn,
    season: drop.filter.season ?? 'in' as const, only_mine: onlyMine, only_drafts: onlyDrafts,
    sort: sortOwn ? 'own' as const : 'date' as const,
  }), [asked, drop.filter.drop, drop.filter.audience, drop.filter.category, drop.filter.status,
    drop.filter.executor, drop.filter.myTurn, drop.filter.season, onlyMine, onlyDrafts, sortOwn])
  const cards = useReferenceFeed(feedFilters)
  const found = { ids: asked ? true : null, why: new Map((cards.data ?? []).map(c => [c.id, c.reasons ?? []])) }
  const height = useFreeHeight()
  const grid = useRef<HTMLDivElement | null>(null)
  const queries = useQueryClient()
  const canCopy = useCan(CODE, 'references', 'write')
  const canTrash = useCan(CODE, 'references', 'delete')
  const canErase = useCan(CODE, 'references', 'delete-forever')
  const canReview = useCan(CODE, 'review', 'write')
  const [rejecting, setRejecting] = useState<Card | null>(null)
  const [trashing, setTrashing] = useState<Card | null>(null)
  const [erasing, setErasing] = useState<Card | null>(null)
  // Выделение (US-0501): Ctrl — добавить или убрать, Shift — от последнего
  // выделенного до этой, пробел — с клавиатуры.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Якорь диапазона — в ref: щелчки идут быстрее отрисовки, и из состояния
  // Shift брал бы прошлый якорь.
  const anchor = useRef<number | null>(null)
  const [bulkDrop, setBulkDrop] = useState('')
  const [bulkTrash, setBulkTrash] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkReport, setBulkReport] = useState<string | null>(null)
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops })
  const plmStatus = useQuery({ queryKey: ['plm-status'], queryFn: fetchPlmStatus })
  const usePlm = Boolean(plmStatus.data?.configured && plmStatus.data.reachable)
  const plmDrops = useQuery({ queryKey: ['plm-drops'], queryFn: () => fetchPlmDrops(), enabled: usePlm })
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople })
  // Перенос мышью: какие карточки, на какое место среди видимых, видимые на
  // момент начала. Во время переноса витрина показывает предварительный
  // порядок — остальные раздвигаются, место видно заранее.
  const [drag, setDrag] = useState<{ ids: number[]; at: number; visible: number[] } | null>(null)
  const ghost = useRef<HTMLDivElement | null>(null)
  // Щелчок, пришедший сразу после переноса, — не «открыть карточку».
  const justDragged = useRef(false)
  // Отмена на витрине (US-0683): порядок целиком и удаление в корзину — одной
  // лентой. Ctrl+Z снимает последнее, Ctrl+Y делает его снова.
  const undoStack = useRef<ShowcaseStep[]>([])
  const redoStack = useRef<ShowcaseStep[]>([])
  const [announce, setAnnounce] = useState('')
  const { ref: openRef } = useParams()
  const [search, setSearch] = useSearchParams()
  const familyId = Number(search.get('family') || 0) || null
  const familyCard = familyId ? (cards.data ?? []).find((c) => c.id === familyId) : undefined
  const more = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = more.current
    if (!node || !cards.hasNextPage || cards.isFetching || cards.loadMoreError) return
    // Запас около одного ряда: следующая порция приходит до упора в конец.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void cards.fetchNextPage()
    }, { rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cards.hasNextPage, cards.isFetching, cards.loadMoreError, cards.fetchNextPage, cards.data?.length])

  function pick(id: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    const order = (shownRef.current ?? []).map((c) => c.id)
    // Якорь — до обновления: функция обновления выполняется позже, когда он
    // уже переписан этим же щелчком.
    const from = anchor.current
    setSelected((s) => {
      const next = new Set(s)
      if (e.shiftKey && from !== null && order.includes(from)) {
        const [a, b] = [order.indexOf(from), order.indexOf(id)].sort((x, y) => x - y)
        order.slice(a, b + 1).forEach((x) => next.add(x))
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    anchor.current = id
  }

  /** Действие над выделенным — по одной карточке, до конца: не вышло с одной —
   *  сказано, с какой и почему, остальные сделаны. */
  async function bulk(what: string, run: (id: number) => Promise<unknown>) {
    const ids = [...selected]
    setBulkBusy(true)
    const failed: string[] = []
    for (const id of ids) {
      try {
        await run(id)
      } catch (e) {
        failed.push(`№${id} — ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBulkBusy(false)
    await queries.invalidateQueries({ queryKey: ['references'] })
    setBulkReport(`${what}: сделано ${ids.length - failed.length} из ${ids.length}.${failed.length ? ' Не вышло: ' + failed.join('; ') : ''}`)
    setSelected(new Set(failed.map((f) => Number(f.slice(1, f.indexOf(' ')))).filter(Boolean)))
  }
  const [eraseReason, setEraseReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  /** Шаг в ленту отмены витрины; новый шаг обрывает повтор. */
  const remember = (step: ShowcaseStep) => {
    undoStack.current.push(step)
    redoStack.current = []
  }

  const act = (run: () => Promise<unknown>) =>
    run()
      .then(() => {
        setActionError(null)
        return queries.invalidateQueries({ queryKey: ['references'] })
      })
      .catch((e: Error) => setActionError(`${e.message} — повторите; если повторится, сервис не отвечает.`))

  // В поиске — порядок совпадения (свой тег первым), без него — свежие первыми.
  const shownRef = useRef<Card[] | undefined>(undefined)
  // Отборы «только мои» и «мои черновики» (US-0686) — рядом с дропом и
  // адресатом; выбор помнит браузер, как и порядок.
  const filtered = cards.data

  // В поиске — порядок совпадения всегда: там важнее, что нашлось первым.
  const shown = filtered && found.ids === null && sortOwn ? ownOrder(filtered) : filtered
  // Во время переноса — предварительный порядок: переносимые на месте курсора.
  const display = shown && drag ? preview(shown, drag.ids, drag.at) : shown
  useFlip(grid, (display ?? []).map((c) => c.id).join(','))
  const rowHeight = Math.max(120, (height.value - GAP * (ROWS - 1)) / ROWS)
  const tiles = useTileWindow(grid, display?.length ?? 0, rowHeight, Math.round(rowHeight * ASPECT), GAP)
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const visibleCards = (display ?? []).map((card, index) => ({ card, index }))
    .filter(({ card, index }) => (index >= tiles.first && index < tiles.end) || card.id === focusedId)

  shownRef.current = shown

  // Порядок витрины — окну: A и D листают карточки в нём (US-0600).
  const order = (shown ?? []).map((c) => c.id).join(',')
  useEffect(() => {
    queries.setQueryData(ORDER_KEY, order ? order.split(',').map(Number) : [])
  }, [order, queries])

  /** Свой порядок целиком — все карточки, не только видимые. */
  const fullOwn = () => fullOwnOrder(queries)

  /** Положить новый порядок: сразу на экран, потом на сервер; не вышло —
   *  вернуть прежний и сказать. */
  async function saveOrder(next: number[], moved: number[], remember = true, previous?: number[]) {
    let prev: number[]
    try { prev = previous ?? await fullOwn() } catch (e) {
      setActionError(`Порядок не пришёл: ${e instanceof Error ? e.message : String(e)} — повторите.`)
      return
    }
    if (next.join(',') === prev.join(',')) return
    if (remember) {
      undoStack.current.push({ kind: 'order', before: prev, after: next })
      redoStack.current = []
    }
    const put = (order: number[]) => patchReferencePositions(queries, order)
    put(next)
    setAnnounce(
      moved.length
        ? `№${moved.join(', №')} — на месте ${next.indexOf(moved[0]) + 1} из ${next.length}`
        : 'порядок возвращён',
    )
    try {
      await setOrder(next)
      await queries.invalidateQueries({ queryKey: ['references'] })
    } catch (e) {
      put(prev)
      setActionError(`Порядок не сохранился: ${e instanceof Error ? e.message : String(e)} — повторите.`)
    }
  }

  async function saveMove(visible: number[], moved: number[], at: number) {
    try {
      const full = await fullOwn()
      await saveOrder(moveTo(full, visible, moved, at), moved, true, full)
    } catch (e) {
      setActionError(`Порядок не пришёл: ${e instanceof Error ? e.message : String(e)} — повторите.`)
    }
  }

  /** Видимые в своём порядке и что переносим: выделенные, если взяли одну из
   *  них, иначе одну. */
  function carried(id: number): { visible: number[]; ids: number[] } {
    const visible = ownOrder(filtered ?? []).map((c) => c.id)
    return { visible, ids: selected.has(id) ? visible.filter((v) => selected.has(v)) : [id] }
  }

  /** Взять карточку мышью: за ручку сразу, долгим нажатием — через 0,35 с. */
  function startDrag(id: number, x: number, y: number) {
    if (found.ids !== null) {
      setAnnounce('В поиске порядок не меняется — сбросьте поиск.')
      return
    }
    setSortOwn(true)
    const { visible, ids } = carried(id)
    const rest = visible.filter((v) => !ids.includes(v))
    let at = placeOf(visible, ids)
    setDrag({ ids, at, visible })
    const place = (px: number, py: number) => {
      if (ghost.current) ghost.current.style.transform = `translate(${px + 14}px, ${py + 14}px)`
    }
    place(x, y)
    const move = (ev: PointerEvent) => {
      place(ev.clientX, ev.clientY)
      const box = grid.current?.getBoundingClientRect()
      // У верхнего и нижнего края окна витрина едет сама: карточки ниже
      // экрана тоже достижимы.
      if (box && grid.current) {
        const scroller = scrollerOf(grid.current)
        if (ev.clientY < 48) scroller.scrollBy(0, -16)
        else if (ev.clientY > window.innerHeight - 48) scroller.scrollBy(0, 16)
      }
      for (const el of grid.current?.querySelectorAll<HTMLElement>('[data-flip]') ?? []) {
        const cid = Number(el.dataset.flip)
        if (ids.includes(cid)) continue
        const r = el.getBoundingClientRect()
        if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) continue
        // Ряды слева направо: соседи по порядку — слева и справа. Левая
        // половина — перед карточкой, правая — после.
        const next = rest.indexOf(cid) + (ev.clientX > r.left + r.width / 2 ? 1 : 0)
        if (next !== at) {
          at = next
          setDrag({ ids, at, visible })
        }
        break
      }
    }
    const stop = (commit: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
      setDrag(null)
      justDragged.current = true
      setTimeout(() => (justDragged.current = false), 0)
      if (commit) void saveMove(visible, ids, at)
    }
    const up = () => stop(true)
    const key = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        stop(false)
        setAnnounce('перенос отменён')
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
  }

  /** Долгое нажатие на карточку — взять её; сдвинул раньше — это не перенос. */
  function pressStart(id: number, e: ReactPointerEvent) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
    const x0 = e.clientX
    const y0 = e.clientY
    const cancel = () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', early)
      window.removeEventListener('pointerup', cancel)
    }
    const early = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) cancel()
    }
    const timer = setTimeout(() => {
      cancel()
      startDrag(id, x0, y0)
    }, 350)
    window.addEventListener('pointermove', early)
    window.addEventListener('pointerup', cancel)
  }

  /** Ручка ⠿: потянул дальше 4 точек — перенос, просто щёлкнул — меню. */
  function gripStart(id: number, e: ReactPointerEvent) {
    const x0 = e.clientX
    const y0 = e.clientY
    const done = () => {
      window.removeEventListener('pointermove', go)
      window.removeEventListener('pointerup', done)
    }
    const go = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      done()
      startDrag(id, ev.clientX, ev.clientY)
    }
    window.addEventListener('pointermove', go)
    window.addEventListener('pointerup', done)
  }

  /** Меню «переместить»: в начало, в конец, перед №… — по всему порядку. */
  async function moveMenu(id: number, to: 'start' | 'end' | number) {
    let full: number[]
    try { full = await fullOwn() } catch (e) {
      setActionError(`Порядок не пришёл: ${e instanceof Error ? e.message : String(e)} — повторите.`)
      return
    }
    const ids = selected.has(id) ? full.filter((v) => selected.has(v)) : [id]
    const rest = full.filter((v) => !ids.includes(v))
    const at = to === 'start' ? 0 : to === 'end' ? rest.length : rest.indexOf(to)
    if (at < 0) {
      setAnnounce(`Карточки №${to} на витрине нет.`)
      return
    }
    setSortOwn(true)
    await saveOrder(moveTo(full, full, ids, at), ids, true, full)
  }

  // Карточки мемоизированы и держат обработчики прошлой отрисовки; свежие
  // функции — здесь, иначе перенос брал бы устаревшее выделение и фильтр.
  const live = useRef({ gripStart, pressStart, moveMenu })
  live.current = { gripStart, pressStart, moveMenu }

  // Ctrl+Z / Ctrl+Y на витрине — порядок и корзина. Открыто окно — клавиши
  // его, витрина под ним их не слышит.
  useEffect(() => {
    const onUndo = (e: globalThis.KeyboardEvent) => {
      if (openRef !== undefined || !(e.ctrlKey || e.metaKey)) return
      const back = e.code === 'KeyZ' && !e.shiftKey
      const again = e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)
      if (!back && !again) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const from = back ? undoStack : redoStack
      const to = back ? redoStack : undoStack
      const step = from.current.pop()
      if (!step) return
      e.preventDefault()
      to.current.push(step)
      if (step.kind === 'order') void saveOrder(back ? step.before : step.after, [], false)
      else {
        const run = back ? restoreReference : trashReference
        void act(() => Promise.all(step.ids.map((id) => run(id))))
        setAnnounce(`${back ? 'возвращено из корзины' : 'снова в корзине'}: ${step.ids.map((id) => `№${id}`).join(', ')}`)
      }
    }
    window.addEventListener('keydown', onUndo)
    return () => window.removeEventListener('keydown', onUndo)
  })

  /** Стрелки ходят по карточкам: вбок — соседняя, вверх-вниз — ряд выше или
   *  ниже; пробел выделяет. */
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const active = document.activeElement as HTMLElement | null
    if (!active?.hasAttribute('data-card')) return
    const id = Number(active.dataset.cardId)
    const at = id ? (display ?? []).findIndex(card => card.id === id) + 1 : 0
    if (e.key === ' ') {
      const id = Number((document.activeElement as HTMLElement).dataset.cardId)
      if (id) {
        e.preventDefault()
        pick(id, { ctrlKey: true, metaKey: false, shiftKey: e.shiftKey })
      }
      return
    }
    // Карточек в ряду — сколько стоит на одной высоте с первой.
    const perRow = tiles.columns
    const by: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow }
    if (!(e.key in by)) return
    e.preventDefault()
    // Переставлять карточки с клавиатуры нельзя (владелец 26.09): порядок
    // меняется только мышью. Alt со стрелками — просто стрелки.
    const next = Math.min(display?.length ?? 0, Math.max(0, at + by[e.key]))
    tiles.reveal(next)
    // Прокрутка сначала монтирует соседний ряд, затем фокус входит в него.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const selector = next === 0 ? '[data-card]:not([data-card-id])' : `[data-card-id="${display![next - 1].id}"]`
      grid.current?.querySelector<HTMLElement>(selector)?.focus()
    }))
  }

  return (
    <main className="p-4">
      <PageHeader
        title="Референсы"
        description={
          found.ids === null
            ? sortOwn
              ? 'порядок вручную: зажмите карточку или возьмите за ⠿ и перетащите; Ctrl+Z — вернуть'
              : 'последние сохранённые первыми'
            : `по запросу «${asked}» — ${cards.total}`
        }
        actions={
          // Вверху — только поиск (владелец 29.09: «вверху справа помойка»):
          // порядок, корзина и клавиши — в одной полосе с отборами.
          <div className="flex w-80 items-center gap-1">
            <TextInput
              maxLength={200}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="поиск: снежное, танк, мишка…"
              aria-label="поиск по картинкам и надписям референсов"
            />
            {query && <IconButton icon="x" aria-label="сбросить поиск" onClick={() => setQuery('')} />}
          </div>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <DropFilterBar {...drop}>
          <div className="w-44 shrink-0">
            <Select
              aria-label="статус"
              options={(Object.keys(STATUS_NAMES) as Status[])
                .filter((s) => s !== 'rejected')
                .map((s) => ({ value: s, label: STATUS_NAMES[s] }))}
              placeholder="любой статус"
              value={drop.filter.status ?? ''}
              onChange={(e) => drop.set({ status: (e.target.value || null) as Status | null })}
            />
          </div>
          <div className="w-44 shrink-0">
            <Select
              aria-label="исполнитель"
              options={(people.data ?? []).map((p) => ({
                value: p.id,
                label: p.full_name || p.display_name,
              }))}
              placeholder="любой исполнитель"
              value={drop.filter.executor ?? ''}
              onChange={(e) => drop.set({ executor: e.target.value || null })}
            />
          </div>
          <div className="w-40 shrink-0">
            <Select
              aria-label="сезон"
              options={(Object.keys(SEASON_NAMES) as SeasonFilter[]).map((s) => ({
                value: s,
                label: SEASON_NAMES[s],
              }))}
              placeholder="в сезоне"
              value={drop.filter.season ?? ''}
              onChange={(e) => drop.set({ season: (e.target.value || null) as SeasonFilter | null })}
            />
          </div>
          <Chip
            on={drop.filter.myTurn}
            set={(fn) => drop.set({ myTurn: fn(drop.filter.myTurn) })}
            title="Только референсы, где сейчас мой ход в согласовании"
          >
            мой ход
          </Chip>
          <Chip on={onlyMine} set={setOnlyMine} title="Только референсы, где я исполнитель">
            только мои
          </Chip>
          <Chip on={onlyDrafts} set={setOnlyDrafts} title="Где у меня несохранённое — подробно в «Моих задачах»">
            мои черновики
          </Chip>
        </DropFilterBar>
        {/* Порядок — отдельно от отборов и назван порядком (US-0686); рядом
            корзина и клавиши — одной полосой, одной высоты. */}
        <div className="mb-3 flex items-center gap-2">
          <div className="w-44">
            <Select
              aria-label="порядок карточек"
              options={[
                { value: 'date', label: 'порядок: по дате' },
                { value: 'own', label: 'порядок: вручную' },
              ]}
              value={sortOwn ? 'own' : 'date'}
              onChange={(e) => setSortOwn(e.target.value === 'own')}
            />
          </div>
          {/* Открыто окно — «?» его: у окна своя подсказка. */}
          <HotkeysHint rows={SHOWCASE_KEYS} label="Клавиши витрины" listen={openRef === undefined} />
        </div>
      </div>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
      <div
        ref={ghost}
        aria-hidden
        className="pf-card pointer-events-none fixed left-0 top-0 z-50 border border-primary bg-background px-2 py-1 text-xs shadow-lg"
        style={{ display: drag ? 'block' : 'none' }}
      >
        {drag && `№${drag.ids.join(', №')}`}
      </div>
      {selected.size > 0 && (
        <div className="pf-card mb-2 flex flex-wrap items-center gap-2 border border-line p-2 text-sm" role="region" aria-label="действия над выделенным">
          <strong>выделено {selected.size}</strong>
          <div className="w-56">
            <Select
              aria-label="дроп для выделенных"
              options={(drops.data ?? []).filter((d) => !d.retired).map((d) => ({ value: String(d.id), label: d.name }))}
              placeholder="дроп…"
              value={bulkDrop}
              onChange={(e) => setBulkDrop(e.target.value)}
            />
          </div>
          <button
            className={buttonClass({ tone: 'accent', variant: 'outline', small: true })}
            disabled={!bulkDrop || bulkBusy}
            onClick={() => void bulk('назначить дроп', (id) => moveToDrop(id, Number(bulkDrop)))}
          >
            назначить дроп
          </button>
          <button
            className={buttonClass({ tone: 'accent', variant: 'outline', small: true })}
            disabled={!bulkDrop || bulkBusy}
            onClick={() => void bulk('скопировать в дроп', (id) => copyReference(id, Number(bulkDrop)))}
          >
            скопировать в дроп
          </button>
          {canTrash && (
            <button className={meaningClass('withdraw', true)} disabled={bulkBusy} onClick={() => setBulkTrash(true)}>
              удалить {selected.size}
            </button>
          )}
          <button
            className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
            onClick={() => {
              setSelected(new Set())
              anchor.current = null
            }}
          >
            снять выделение
          </button>
          <span className="text-xs text-muted-foreground">Ctrl — добавить, Shift — диапазон, пробел — с клавиатуры</span>
        </div>
      )}
      {bulkReport && (
        <p role="status" className="mb-2 flex gap-2 text-sm">
          <span className="flex-1">{bulkReport}</span>
          <button onClick={() => setBulkReport(null)} aria-label="скрыть отчёт">
            ×
          </button>
        </p>
      )}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <ThumbnailProgress root={grid} pending={cards.isPending} />
      {cards.isError && (
        <EmptyState
          title="Референсы не пришли"
          description="Сервис не ответил. Обновите страницу; если повторится — стенд сервиса не поднят."
          action={
            <button className={buttonClass({ tone: 'accent', variant: 'solid' })} onClick={() => void cards.refetch()}>
              повторить
            </button>
          }
        />
      )}
        <div
          ref={(el) => {
            grid.current = el
            height.measure(el)
          }}
          onKeyDown={onKey}
          onFocusCapture={(e) => setFocusedId(Number((e.target as HTMLElement).dataset.cardId) || null)}
          style={{
            display: cards.isError ? 'none' : 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(rowHeight * ASPECT)}px, 1fr))`,
            gridAutoRows: rowHeight,
            gridTemplateRows: `repeat(${tiles.rows}, ${rowHeight}px)`,
            gap: GAP,
            paddingBottom: 4,
          }}
        >
          <button
            data-card
            style={{ gridRow: 1, gridColumn: 1 }}
            onClick={() => setCreating(true)}
            className="pf-card flex flex-col items-center justify-center gap-1 border border-dashed border-line text-muted-foreground"
            title="Новый референс: выбрать изделие и цвет"
          >
            <span style={{ fontSize: rowHeight / 3, lineHeight: 1 }}>+</span>
            <span className="text-sm">новый референс</span>
          </button>
          {visibleCards.map(({ card: c, index }) => (
            <ShowcaseCard
              key={c.id}
              card={c}
              gridPosition={tiles.position(index + 1)}
              dragging={drag?.ids.includes(c.id) ?? false}
              onGrip={found.ids === null ? (e) => live.current.gripStart(c.id, e) : undefined}
              onPress={found.ids === null ? (e) => live.current.pressStart(c.id, e) : undefined}
              onMoveTo={found.ids === null ? (to) => live.current.moveMenu(c.id, to) : undefined}
              onOpen={(e) => {
                if (justDragged.current) return
                if (e.ctrlKey || e.metaKey || e.shiftKey) pick(c.id, e)
                // Сначала семейство цветов (US-0891), не сразу окно.
                else {
                  const next = new URLSearchParams(search)
                  next.set('family', String(c.id))
                  setSearch(next, { replace: false })
                }
              }}
              onHover={() => prefetchCard(queries, c.id)}
              selected={selected.has(c.id)}
              reasons={found.ids === null ? undefined : found.why.get(c.id)}
              onCopy={canCopy ? () => void act(() => copyReference(c.id)) : undefined}
              onTrash={canTrash ? () => setTrashing(c) : undefined}
              onReject={canReview && c.can_reject ? () => setRejecting(c) : undefined}
              onErase={canErase ? () => setErasing(c) : undefined}
              note={seasonNote(c, drops.data, usePlm ? plmDrops.data : undefined)}
            />
          ))}

          {!cards.isPending && cards.data?.length === 0 && (
            <div className="col-span-full self-center text-sm text-muted-foreground">
              Под этот отбор референсов нет. Измените фильтры или создайте новый.
              <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => {
                drop.reset(); setQuery('')
                setSearch(new URLSearchParams({ sort: sortOwn ? 'own' : 'date', mine: '0', drafts: '0' }), { replace: true })
              }}>сбросить отбор</button>
            </div>
          )}
        </div>

      {!cards.isPending && !cards.isError && (
        <div ref={more} className="my-4 flex items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          {cards.isFetchingNextPage && <Spinner />}
          <span>Загружено {cards.data?.length ?? 0} из {cards.total}</span>
          {cards.loadMoreError ? <>
            <span>Следующая порция не пришла.</span>
            <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => void cards.fetchNextPage()}>повторить дозагрузку</button>
          </> : cards.hasNextPage && !cards.isFetchingNextPage && (
            <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => void cards.fetchNextPage()}>показать ещё</button>
          )}
        </div>
      )}

      <ReviewDecisionModal card={rejecting} action="reject" onClose={() => setRejecting(null)} onDone={() => {
        if (rejecting) setSelected(previous => { const next = new Set(previous); next.delete(rejecting.id); return next })
        setRejecting(null)
      }} />

      <Modal
        open={trashing !== null}
        onClose={() => setTrashing(null)}
        title="Удалить в корзину?"
        actions={
          <>
            <button className={buttonClass({ tone: 'neutral', variant: 'outline' })} onClick={() => setTrashing(null)}>
              оставить
            </button>
            <button
              className={meaningClass('withdraw')}
              onClick={() => {
                const c = trashing
                setTrashing(null)
                if (c) void act(() => trashReference(c.id)).then(() => remember({ kind: 'trash', ids: [c.id] }))
              }}
            >
              в корзину
            </button>
          </>
        }
      >
        {trashing &&
          `Референс №${trashing.id} пропадёт с витрины и из поиска. 30 дней его можно вернуть из корзины целиком, с историей.`}
      </Modal>

      <Modal
        open={bulkTrash}
        onClose={() => setBulkTrash(false)}
        title={`Удалить ${selected.size} в корзину?`}
        actions={
          <>
            <button className={buttonClass({ tone: 'neutral', variant: 'outline' })} onClick={() => setBulkTrash(false)}>
              оставить
            </button>
            <button
              className={meaningClass('withdraw')}
              onClick={() => {
                setBulkTrash(false)
                const ids = [...selected]
                void bulk('удалить в корзину', (id) => trashReference(id)).then(() => remember({ kind: 'trash', ids }))
              }}
            >
              удалить {selected.size}
            </button>
          </>
        }
      >
        Выделенные референсы пропадут с витрины и из поиска; 30 дней их можно вернуть из корзины целиком, с историей.
      </Modal>

      <Modal
        open={erasing !== null}
        onClose={() => setErasing(null)}
        title="Удалить насовсем сразу?"
        actions={
          <>
            <button className={buttonClass({ tone: 'neutral', variant: 'outline' })} onClick={() => setErasing(null)}>
              оставить
            </button>
            <button
              className={buttonClass({ tone: 'danger', variant: 'solid' })}
              disabled={!eraseReason.trim()}
              onClick={() => {
                const c = erasing
                const why = eraseReason.trim()
                setErasing(null)
                setEraseReason('')
                if (c) void act(() => eraseForever(c.id, why))
              }}
            >
              удалить насовсем
            </button>
          </>
        }
      >
        {erasing && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Референс №{erasing.id} исчезнет сразу и отовсюду — со всеми версиями и снимками, мимо корзины. В журнале
              останется кто, когда и почему. Картинки, из которых он собран, останутся в библиотеке — их можно
              забраковать на «Принтах».
            </p>
            <TextInput
              value={eraseReason}
              onChange={(e) => setEraseReason(e.target.value)}
              placeholder="почему — обязательно: «зашквар: Санта на унитазе»"
              aria-label="причина удаления насовсем"
              autoFocus
            />
          </div>
        )}
      </Modal>

      {familyId && (
        <FamilyPopup
          referenceId={familyId}
          name={familyCard?.name || `№${familyId}`}
            onOpen={() => {
              const next = new URLSearchParams(search)
              next.delete('family')
              next.delete('colour')
                next.delete('plm_colorway')
              navigate(`/references/${familyId}?${next}`, { state: { inApp: true, fromFamily: familyId } })
            }}
          onClose={() => {
            const next = new URLSearchParams(search)
            next.delete('family')
            setSearch(next, { replace: true })
          }}
          onPick={(colour, colorwayId) => {
            const next = new URLSearchParams(search)
            next.delete('family')
            next.set('colour', colour)
            if (colorwayId) next.set('plm_colorway', colorwayId)
            navigate(`/references/${familyId}?${next}`, {
              state: { inApp: true, fromFamily: familyId },
            })
          }}
        />
      )}

      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onPickLocal={(colourModel, colour) => {
          setCreating(false)
          navigate(`/references/new?colour_model=${colourModel}&colour=${encodeURIComponent(colour)}`)
        }}
        onPickPlm={(cw, dropCode) => {
          if (!cw.can_work || !cw.product_code) return
          setCreating(false)
          const colour = cw.color ?? cw.base_color ?? 'WHITE'
          navigate(
            `/references/new?product=${encodeURIComponent(cw.product_code)}&plm_colorway=${encodeURIComponent(cw.id)}&colour=${encodeURIComponent(colour)}&plm_drop=${encodeURIComponent(dropCode)}`,
          )
        }}
      />
    </main>
  )
}

/** «+»: PLM, если настроен, иначе стендовый справочник (US-0886). */
function CreateDialog({
  open,
  onClose,
  onPickLocal,
  onPickPlm,
}: {
  open: boolean
  onClose: () => void
  onPickLocal: (colourModelId: number, colourCode: string) => void
  onPickPlm: (cw: PlmColorway, dropCode: string) => void
}) {
  const plm = useQuery({ queryKey: ['plm-status'], queryFn: fetchPlmStatus, enabled: open })
  const usePlm = Boolean(plm.data?.configured && plm.data.reachable)
  const tree = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue, enabled: open && !usePlm })
  const palette = useQuery({ queryKey: ['palette'], queryFn: fetchPalette, enabled: open })
  const [drop, setDrop] = useState('')
  const [limit, setLimit] = useState(24)
  useEffect(() => setLimit(24), [drop])
  const plmDrops = useQuery({ queryKey: ['plm-drops'], queryFn: () => fetchPlmDrops(), enabled: open && usePlm })
  const colorways = useQuery({
    queryKey: ['plm-colorways', drop],
    queryFn: () => fetchPlmColorways(drop || undefined),
    enabled: open && usePlm && Boolean(drop),
    retry: false,
  })
  const models = (tree.data ?? []).flatMap(modelsOf)
  const colourOf = (code: string) => palette.data?.colors.find((c) => c.code === code)

  useEffect(() => {
    if (!drop && (plmDrops.data?.length ?? 0) > 0) setDrop(plmDrops.data![0].code)
  }, [plmDrops.data, drop])

  return (
    <Modal open={open} onClose={onClose} title="Новый референс">
      {plm.isPending && <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Проверяем каталог PLM</div>}
      {usePlm && palette.isError && <div role="alert" className="mb-2 text-sm text-destructive">Палитра PLM не пришла — выбор цвета временно недоступен.{' '}
        <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => void palette.refetch()}>повторить</button></div>}
      {plm.data?.configured && !plm.data.reachable && (
        <p className="mb-2 text-sm text-muted-foreground">plm недоступен: {plm.data.message}. Локальный справочник стенда ниже.</p>
      )}
      {usePlm ? (
        <>
          <div className="mb-3 w-64">
            <Select
              aria-label="дроп plm"
              options={(plmDrops.data ?? []).map((d) => ({
                value: d.code,
                label: [d.code, d.season, d.description].filter(Boolean).join(' · '),
              }))}
              placeholder="дроп plm"
              value={drop}
              onChange={(e) => setDrop(e.target.value)}
            />
          </div>
          {colorways.isPending && <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Получаем модели и цвета PLM</div>}
          {colorways.isError && <div role="alert" className="text-sm">{(colorways.error as Error).message}{' '}
            <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => void colorways.refetch()}>повторить</button></div>}
          <div className="flex flex-wrap gap-3">
            {(colorways.data ?? []).slice(0, limit).map((cw) => (
              <button
                key={cw.id}
                disabled={!drop || !cw.can_work || !palette.data}
                onClick={() => onPickPlm({ ...cw, color: colorwayColourCode(cw, palette.data?.colors ?? []) }, drop)}
                className={`${buttonClass({ tone: 'neutral', variant: 'outline' })} w-40 flex-col items-stretch`}
                title={!drop ? 'Выберите дроп для семьи' : cw.can_work ? `работа: ${cw.article}` : (cw.reason ?? '')}
              >
                <PlmModelImage id={cw.id} image={cw.image} label={`${cw.style_code} · ${cw.article}`} />
                  <span
                    className="mb-1 block h-8 w-full rounded-sm border border-line"
                    style={{ background: rgbCss(cw.rgb) }}
                    aria-hidden
                  />
                <span className="block truncate text-left text-sm font-semibold" title={cw.color ?? cw.article}>{cw.color ?? cw.article}</span>
                <span className="block truncate text-left text-xs text-muted-foreground" title={`${cw.style_code} · ${cw.article}`}>{cw.style_code} · {cw.article}</span>
                {!cw.can_work && <span className="mt-1 block text-left text-xs text-muted-foreground">{cw.reason}</span>}
              </button>
            ))}
          </div>
          {(colorways.data?.length ?? 0) > limit && <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
            onClick={() => setLimit(previous => previous + 24)}>ещё модели · показано {limit} из {colorways.data!.length}</button>}
        </>
      ) : (
        <>
          {tree.isPending && <p className="text-sm">Загружаю изделия…</p>}
          {tree.isError && <p className="text-sm">Справочник изделий не ответил — закройте окно и попробуйте ещё раз.</p>}
          {models.map((m) => (
            <section key={m.id} className="mb-3">
              <div className="text-sm font-semibold">
                {m.name} <span className="font-normal text-muted-foreground">{m.code}</span>
              </div>
              {!m.can_work && <p className="text-xs text-muted-foreground">{m.reason}</p>}
              <div className="mt-1 flex flex-wrap gap-2">
                {m.colour_models.map((cm) => {
                  const colour = colourOf(cm.colour_code)
                  return (
                    <button
                      key={cm.id}
                      disabled={!m.can_work}
                      onClick={() => onPickLocal(cm.id, cm.colour_code)}
                      className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
                      title={m.can_work ? `начать работу: ${colour?.name ?? cm.colour_code}` : (m.reason ?? '')}
                    >
                      <span
                        className="mr-1 inline-block h-3 w-3 rounded-sm border border-line align-middle"
                        style={{ background: colour ? toCss(colour) : undefined }}
                      />
                      {colour?.group ?? cm.colour_code}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </Modal>
  )
}

function modelsOf(node: TreeNode): TreeNode['models'] {
  return [...node.models, ...node.children.flatMap(modelsOf)]
}

/** Высота от верха витрины до низа окна: три строки делят именно её. */
function useFreeHeight(): { value: number; measure: (el: HTMLElement | null) => void } {
  const [top, setTop] = useState(160)
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)
  const el = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const update = () => {
      setWindowHeight(window.innerHeight)
      if (el.current) setTop(el.current.getBoundingClientRect().top + window.scrollY)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return {
    value: Math.max(3 * 120, windowHeight - top - 16),
    measure: (node) => {
      el.current = node
    },
  }
}

/** Шаг ленты отмены витрины: порядок целиком — до и после, или удалённые
 *  в корзину (одна карточка или пачка) — возвращаются тем же шагом. */
type ShowcaseStep = { kind: 'order'; before: number[]; after: number[] } | { kind: 'trash'; ids: number[] }

/** Отбор-включатель в ряду отборов. */
function Chip(props: { on: boolean; set: (v: (was: boolean) => boolean) => void; title: string; children: string }) {
  return (
    <button
      className={buttonClass({ tone: props.on ? 'accent' : 'neutral', variant: props.on ? 'soft' : 'outline', small: true })}
      aria-pressed={props.on}
      onClick={() => props.set((v) => !v)}
      title={props.title}
    >
      {props.on ? '✓ ' : ''}
      {props.children}
    </button>
  )
}

/** Что прокручивается под витриной: ближайший предок с прокруткой по
 *  вертикали, иначе страница. В оболочке платформы это её колонка. */
function scrollerOf(el: HTMLElement): { scrollBy: (x: number, y: number) => void } {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return window
}

/** На остросезонном — срок «до ДД.ММ» (US-0888). */
function seasonNote(
  card: Card,
  local: Drop[] | undefined,
  plm: PlmDrop[] | undefined,
): { text: string; tone?: 'warning' | 'muted' }[] | undefined {
  if (plm?.length) {
    const sharp = plm.filter(
      (d) =>
        (card.drops.includes(d.code) || card.drops.includes(d.description ?? '')) &&
        profileFromWeeks(d.intake_week, d.exit_week) === 'sharp' &&
        d.exit_week != null,
    )
    if (sharp[0]?.exit_week != null) return [{ text: untilWeekLabel(sharp[0].exit_week), tone: 'muted' }]
  }
  if (local?.length && card.drop_ids.length) {
    const sharp = local.filter(
      (d) => card.drop_ids.includes(d.id) && profileFromDates(d.release_from, d.release_to) === 'sharp',
    )
    if (sharp[0]) return [{ text: untilDateLabel(sharp[0].release_to), tone: 'muted' }]
  }
  return undefined
}

