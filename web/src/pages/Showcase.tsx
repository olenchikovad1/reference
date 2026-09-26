// Витрина референсов (US-0491): работы карточками — изделие спереди и сзади,
// а не список имён. Три строки при любой высоте окна, столбцов — сколько
// помещается, остальное листается вбок. Первая карточка — «+»: новый референс
// начинается отсюда, выбором изделия и цвета.
//
// Картинки карточек — снимки, сделанные при сохранении (views версии), а не
// отрисовка на лету: шестьдесят карточек не должны рисовать сто двадцать
// изделий.

import { EmptyState, Modal, PageHeader, Select, TextInput, buttonClass } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, memo, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { CODE } from '../app/shell'
import { warmGarments } from '../candidates/GarmentCanvas'
import { frameUrl, productQuery } from '../shared/api/products'
import { DropFilterBar } from '../candidates/DropFilter'
import { useFlip } from '../candidates/useFlip'
import { moveTo, ownOrder, placeOf, preview } from '../shared/order'
import { passes, useDropFilter } from '../shared/filters'
import { useCan } from '../shared/api/platform'

import { assetUrl } from '../shared/api/assets'
import { ORDER_KEY, prefetchCard } from '../shared/cardCache'
import { fetchPalette, toCss } from '../shared/api/colours'
import { fetchCatalogue, type TreeNode } from '../shared/api/drops'
import {
  copyReference,
  eraseForever,
  findReferences,
  listReferences,
  moveToDrop,
  setOrder,
  trashReference,
  type Card,
} from '../shared/api/references'
import { fetchDrops } from '../shared/api/drops'

/** Где браузер помнит выбранный порядок витрины. */
const SORT_KEY = 'reference.showcase.sort'

/** Строк на витрине — ровно три, при любой высоте окна. */
const ROWS = 3
const GAP = 12
/** Ширина карточки к высоте: изделие почти квадратное, плюс подпись снизу. */
const ASPECT = 0.8

export function Showcase() {
  const cards = useQuery({ queryKey: ['references'], queryFn: listReferences })
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const found = useFound(query)
  const drop = useDropFilter()
  const height = useFreeHeight()
  const grid = useRef<HTMLDivElement | null>(null)
  const queries = useQueryClient()
  // Окно откроется мгновенно: изделие и его кадры грузятся, пока человек
  // выбирает карточку. Изделие на стенде одно — B-HDY-14.
  useEffect(() => {
    void queries.fetchQuery(productQuery('B-HDY-14')).then((p) => warmGarments(p.states.map((s) => frameUrl(p.code, s.code))))
  }, [queries])
  const canCopy = useCan(CODE, 'references', 'write')
  const canTrash = useCan(CODE, 'references', 'delete')
  const canErase = useCan(CODE, 'references', 'delete-forever')
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
  // Свой порядок (US-0601): «по дате» или «мой». Выбор помнит браузер —
  // это удобство смотрящего, а не данные.
  const [sortOwn, setSortOwn] = useState(() => {
    try {
      return localStorage.getItem(SORT_KEY) === 'own'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sortOwn ? 'own' : 'date')
    } catch {
      // хранилище запрещено — выбор проживёт до перезагрузки
    }
  }, [sortOwn])
  // Перенос мышью: какие карточки, на какое место среди видимых, видимые на
  // момент начала. Во время переноса витрина показывает предварительный
  // порядок — остальные раздвигаются, место видно заранее.
  const [drag, setDrag] = useState<{ ids: number[]; at: number; visible: number[] } | null>(null)
  const ghost = useRef<HTMLDivElement | null>(null)
  // Щелчок, пришедший сразу после переноса, — не «открыть карточку».
  const justDragged = useRef(false)
  // Прежние порядки для Ctrl+Z: отмена — это тоже порядок целиком.
  const undoOrders = useRef<number[][]>([])
  const [announce, setAnnounce] = useState('')
  const { ref: openRef } = useParams()

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
  const act = (run: () => Promise<unknown>) =>
    run()
      .then(() => {
        setActionError(null)
        return queries.invalidateQueries({ queryKey: ['references'] })
      })
      .catch((e: Error) => setActionError(`${e.message} — повторите; если повторится, сервис не отвечает.`))

  // В поиске — порядок совпадения (свой тег первым), без него — свежие первыми.
  const shownRef = useRef<Card[] | undefined>(undefined)
  const filtered = (
    found.ids === null ? cards.data : found.ids.flatMap((id) => cards.data?.find((c) => c.id === id) ?? [])
  )?.filter((c) =>
    passes(
      { drops: c.drop_ids, audiences: c.audience ? [c.audience] : [], categories: c.category ? [c.category] : [] },
      drop.filter,
    ),
  )
  // В поиске — порядок совпадения всегда: там важнее, что нашлось первым.
  const shown = filtered && found.ids === null && sortOwn ? ownOrder(filtered) : filtered
  // Во время переноса — предварительный порядок: переносимые на месте курсора.
  const display = shown && drag ? preview(shown, drag.ids, drag.at) : shown
  useFlip(grid, (display ?? []).map((c) => c.id).join(','))
  const rowHeight = Math.max(120, (height.value - GAP * (ROWS - 1)) / ROWS)

  shownRef.current = shown

  // Порядок витрины — окну: A и D листают карточки в нём (US-0600).
  const order = (shown ?? []).map((c) => c.id).join(',')
  useEffect(() => {
    queries.setQueryData(ORDER_KEY, order ? order.split(',').map(Number) : [])
  }, [order, queries])

  /** Свой порядок целиком — все карточки, не только видимые. */
  const fullOwn = () => ownOrder(cards.data ?? []).map((c) => c.id)

  /** Положить новый порядок: сразу на экран, потом на сервер; не вышло —
   *  вернуть прежний и сказать. */
  async function saveOrder(next: number[], moved: number[], remember = true) {
    const prev = fullOwn()
    if (next.join(',') === prev.join(',')) return
    if (remember) undoOrders.current.push(prev)
    const put = (order: number[]) => {
      const pos = new Map(order.map((id, i) => [id, i]))
      queries.setQueryData<Card[]>(['references'], (cs) => cs?.map((c) => ({ ...c, my_position: pos.get(c.id) ?? null })))
    }
    put(next)
    setAnnounce(
      moved.length
        ? `№${moved.join(', №')} — на месте ${next.indexOf(moved[0]) + 1} из ${next.length}`
        : 'порядок возвращён',
    )
    try {
      await setOrder(next)
    } catch (e) {
      put(prev)
      setActionError(`Порядок не сохранился: ${e instanceof Error ? e.message : String(e)} — повторите.`)
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
      // У края витрина едет сама: карточки дальше экрана тоже достижимы.
      if (box && grid.current) {
        if (ev.clientX < box.left + 48) grid.current.scrollLeft -= 16
        else if (ev.clientX > box.right - 48) grid.current.scrollLeft += 16
      }
      for (const el of grid.current?.querySelectorAll<HTMLElement>('[data-flip]') ?? []) {
        const cid = Number(el.dataset.flip)
        if (ids.includes(cid)) continue
        const r = el.getBoundingClientRect()
        if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) continue
        // Столбцы по три: соседи по порядку — сверху и снизу. Верхняя
        // половина — перед карточкой, нижняя — после.
        const next = rest.indexOf(cid) + (ev.clientY > r.top + r.height / 2 ? 1 : 0)
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
      if (commit) void saveOrder(moveTo(fullOwn(), visible, ids, at), ids)
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
  function moveMenu(id: number, to: 'start' | 'end' | number) {
    const full = fullOwn()
    const ids = selected.has(id) ? full.filter((v) => selected.has(v)) : [id]
    const rest = full.filter((v) => !ids.includes(v))
    const at = to === 'start' ? 0 : to === 'end' ? rest.length : rest.indexOf(to)
    if (at < 0) {
      setAnnounce(`Карточки №${to} на витрине нет.`)
      return
    }
    setSortOwn(true)
    void saveOrder(moveTo(full, full, ids, at), ids)
  }

  // Карточки мемоизированы и держат обработчики прошлой отрисовки; свежие
  // функции — здесь, иначе перенос брал бы устаревшее выделение и фильтр.
  const live = useRef({ gripStart, pressStart, moveMenu })
  live.current = { gripStart, pressStart, moveMenu }

  // Ctrl+Z на витрине — вернуть прежний порядок. Открыто окно — отмена его.
  useEffect(() => {
    const onUndo = (e: globalThis.KeyboardEvent) => {
      if (openRef !== undefined || !(e.ctrlKey || e.metaKey) || e.code !== 'KeyZ' || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const prev = undoOrders.current.pop()
      if (!prev) return
      e.preventDefault()
      void saveOrder(prev, [], false)
    }
    window.addEventListener('keydown', onUndo)
    return () => window.removeEventListener('keydown', onUndo)
  })

  /** Стрелки ходят по карточкам: вверх-вниз — в столбце, вбок — на столбец;
   *  пробел выделяет. */
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = [...(grid.current?.querySelectorAll<HTMLButtonElement>('[data-card]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    if (e.key === ' ') {
      const id = Number((document.activeElement as HTMLElement).dataset.cardId)
      if (id) {
        e.preventDefault()
        pick(id, { ctrlKey: true, metaKey: false, shiftKey: e.shiftKey })
      }
      return
    }
    const by: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: ROWS, ArrowLeft: -ROWS }
    if (!(e.key in by)) return
    e.preventDefault()
    // Переставлять карточки с клавиатуры нельзя (владелец 26.09): порядок
    // меняется только мышью. Alt со стрелками — просто стрелки.
    const next = all[Math.min(all.length - 1, Math.max(0, at + by[e.key]))]
    next.focus()
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <main className="p-4">
      <PageHeader
        title="Референсы"
        description={
          found.ids === null
            ? sortOwn
              ? 'мой порядок: зажмите карточку или возьмите за ⠿ и перетащите; Ctrl+Z — вернуть'
              : 'последние сохранённые первыми'
            : `по запросу «${query.trim()}» — ${shown?.length ?? 0}`
        }
        actions={
          <div className="flex items-center gap-2">
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="снежное, танк, мишка…"
              aria-label="поиск по картинкам и надписям референсов"
            />
            {query && (
              <button className={buttonClass({ tone: 'neutral', variant: 'outline' })} onClick={() => setQuery('')}>
                сбросить
              </button>
            )}
            <Link to="/references/trash" className={buttonClass({ tone: 'neutral', variant: 'outline' })}>
              корзина
            </Link>
          </div>
        }
      />
      <DropFilterBar {...drop} />
      <div className="mb-2 flex items-center gap-1 text-xs" role="group" aria-label="порядок карточек">
        <span className="text-muted-foreground">порядок:</span>
        <button className={buttonClass({ tone: sortOwn ? 'neutral' : 'accent', variant: sortOwn ? 'outline' : 'soft', small: true })} aria-pressed={!sortOwn} onClick={() => setSortOwn(false)}>
          по дате
        </button>
        <button className={buttonClass({ tone: sortOwn ? 'accent' : 'neutral', variant: sortOwn ? 'soft' : 'outline', small: true })} aria-pressed={sortOwn} onClick={() => setSortOwn(true)}>
          мой
        </button>
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
            <button className={buttonClass({ tone: 'danger', variant: 'outline', small: true })} disabled={bulkBusy} onClick={() => setBulkTrash(true)}>
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
      {found.error && <p className="text-sm text-muted-foreground">{found.error} — поиск повторится, если изменить запрос.</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {cards.isError ? (
        <EmptyState
          title="Референсы не пришли"
          description="Сервис не ответил. Обновите страницу; если повторится — стенд сервиса не поднят."
          action={
            <button className={buttonClass({ tone: 'accent', variant: 'solid' })} onClick={() => void cards.refetch()}>
              повторить
            </button>
          }
        />
      ) : (
        <div
          ref={(el) => {
            grid.current = el
            height.measure(el)
          }}
          onKeyDown={onKey}
          style={{
            height: height.value,
            display: 'grid',
            gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
            gridAutoFlow: 'column',
            gridAutoColumns: rowHeight * ASPECT,
            gap: GAP,
            overflowX: 'auto',
            paddingBottom: 4,
          }}
        >
          <button
            data-card
            onClick={() => setCreating(true)}
            className="pf-card flex flex-col items-center justify-center gap-1 border border-dashed border-line text-muted-foreground"
            title="Новый референс: выбрать изделие и цвет"
          >
            <span style={{ fontSize: rowHeight / 3, lineHeight: 1 }}>+</span>
            <span className="text-sm">новый референс</span>
          </button>
          {cards.isPending && <p className="text-sm text-muted-foreground">Загружаю референсы…</p>}
          {display?.map((c) => (
            <ShowcaseCard
              key={c.id}
              card={c}
              dragging={drag?.ids.includes(c.id) ?? false}
              onGrip={found.ids === null ? (e) => live.current.gripStart(c.id, e) : undefined}
              onPress={found.ids === null ? (e) => live.current.pressStart(c.id, e) : undefined}
              onMoveTo={found.ids === null ? (to) => live.current.moveMenu(c.id, to) : undefined}
              onOpen={(e) => {
                if (justDragged.current) return
                if (e.ctrlKey || e.metaKey || e.shiftKey) pick(c.id, e)
                else navigate(`/references/${c.id}`)
              }}
              onHover={() => prefetchCard(queries, c.id)}
              selected={selected.has(c.id)}
              reasons={found.ids === null ? undefined : found.why.get(c.id)}
              onCopy={canCopy ? () => void act(() => copyReference(c.id)) : undefined}
              onTrash={canTrash ? () => setTrashing(c) : undefined}
              onErase={canErase ? () => setErasing(c) : undefined}
            />
          ))}
          {cards.data?.length === 0 && (
            <p className="self-center text-sm text-muted-foreground">
              Пока ни одного — «+» начинает первый.
            </p>
          )}
          {found.ids !== null && shown?.length === 0 && (
            <p className="self-center text-sm text-muted-foreground">
              Ничего не нашлось — назовите предмет, а не настроение: «танк», а не «грозно».
            </p>
          )}
        </div>
      )}

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
              className={buttonClass({ tone: 'danger', variant: 'solid' })}
              onClick={() => {
                const c = trashing
                setTrashing(null)
                if (c) void act(() => trashReference(c.id))
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
              className={buttonClass({ tone: 'danger', variant: 'solid' })}
              onClick={() => {
                setBulkTrash(false)
                void bulk('удалить в корзину', (id) => trashReference(id))
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

      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onPick={(colourModel, colour) =>
          navigate(`/references/new?colour_model=${colourModel}&colour=${encodeURIComponent(colour)}`)
        }
      />
    </main>
  )
}

/** Карточка: перед в левом нижнем углу, спина в правом верхнем, внахлёст.
 *  Нажатие открывает окно; «копия» и «удалить» — отдельными кнопками в углу,
 *  а не меню: делают их часто и без открытия. */
/**
 * Карточка витрины перерисовывается, только когда поменялась она сама
 * (правка владельца 26.09): витрина показывает сохранённое, и сохранение
 * одной карточки не должно перерисовывать остальные. Список после сохранения
 * перечитывается, но неизменённые карточки приходят теми же объектами —
 * сравнение по ссылке их пропускает. Обработчики не сравниваются: они берут
 * актуальное через ref и функциональные обновления.
 */
const ShowcaseCard = memo(
  ShowcaseCardView,
  (a, b) =>
    a.card === b.card &&
    a.selected === b.selected &&
    a.dragging === b.dragging &&
    !a.onGrip === !b.onGrip &&
    a.reasons === b.reasons &&
    !a.onCopy === !b.onCopy &&
    !a.onTrash === !b.onTrash &&
    !a.onErase === !b.onErase,
  // Обработчики не сравниваются: они зовут свежие функции через ref (live).
)

function ShowcaseCardView({
  card,
  onOpen,
  onHover,
  dragging,
  onGrip,
  onPress,
  onMoveTo,
  onCopy,
  onTrash,
  onErase,
  reasons,
  selected,
}: {
  card: Card
  /** Выделена для действия над несколькими (US-0501). */
  selected?: boolean
  /** Почему найдена — при поиске (US-0498). */
  reasons?: string[]
  onOpen: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void
  /** Мышь над карточкой — карточку готовят заранее (US-0600). */
  onHover?: () => void
  /** Её сейчас переносят: на её месте — пустое место с чертой (US-0601). */
  dragging?: boolean
  /** Взяли за ручку ⠿ — перенос сразу. */
  onGrip?: (e: ReactPointerEvent) => void
  /** Нажали на карточку — долгое нажатие станет переносом. */
  onPress?: (e: ReactPointerEvent) => void
  /** Меню «переместить». */
  onMoveTo?: (to: 'start' | 'end' | number) => void
  onCopy?: () => void
  onTrash?: () => void
  onErase?: () => void
}) {
  const front = card.views.front
  const back = card.views.back
  const corner = buttonClass({ tone: 'neutral', variant: 'outline', small: true })
  const [menu, setMenu] = useState(false)
  const [before, setBefore] = useState('')
  return (
    <div data-flip={card.id} className={`group relative flex min-h-0 flex-col ${dragging ? 'opacity-40' : ''}`}>
      {/* Куда встанет — видно заранее: черта над местом переносимой. */}
      {dragging && <div aria-hidden className="absolute -top-2 left-0 right-0 z-10 h-1 rounded bg-primary" />}
    <button
      data-card
      data-card-id={card.id}
      aria-pressed={selected}
      onClick={(e) => onOpen(e)}
      onPointerDown={onPress}
      onPointerEnter={onHover}
      onFocus={onHover}
      className={`pf-card flex min-h-0 flex-1 flex-col overflow-hidden border text-left ${selected ? 'border-primary ring-2 ring-primary' : 'border-line'}`}
      title={`${card.name} · версия ${card.number}`}
    >
      <div className="relative min-h-0 flex-1">
        {back && (
          <img src={assetUrl(back, 'thumb')} alt="спина" className="absolute right-0 top-0 h-[64%] w-[64%] object-contain" />
        )}
        {front && (
          <img src={assetUrl(front, 'thumb')} alt="перед" className="absolute bottom-0 left-0 h-[64%] w-[64%] object-contain" />
        )}
        {!front && !back && (
          <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
            снимка нет — сохранён до витрины
          </span>
        )}
      </div>
      <div className="px-2 py-1 text-xs">
        <div className="truncate font-semibold">
          №{card.id} · {card.name}
        </div>
        <div className="truncate text-muted-foreground">
          {card.drops[0] ?? 'без дропа'} · {new Date(card.saved_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
          {card.forked_from_id && ` · от №${card.forked_from_id}`}
        </div>
        {/* Несохранённое поверх версий (US-0598): своё — «черновик», чужое —
            чьё, чтобы не удивляться, что у коллеги на экране другое. */}
        {(card.my_draft || (card.others_drafts?.length ?? 0) > 0) && (
          <div
            className="truncate text-warning"
            title="Правки поверх последней версии, ещё не ставшие версией. На витрине — последняя версия."
          >
            {[card.my_draft && 'мой черновик', card.others_drafts?.length && `несохранённое у: ${card.others_drafts.join(', ')}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
        {reasons?.slice(0, 2).map((r) => (
          <div key={r} className="truncate text-primary" title={r}>
            {r}
          </div>
        ))}
      </div>
    </button>
      {onGrip && (
        <button
          className={`${corner} absolute right-1 top-1 cursor-grab opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100`}
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            e.preventDefault()
            onGrip(e)
          }}
          onClick={() => {
            // Щелчок после переноса мышью — не просьба о меню.
            if (!dragging) setMenu((m) => !m)
          }}
          title="Тяните, чтобы переставить; щелчок — меню «переместить»"
          aria-label={`переместить №${card.id}`}
          aria-expanded={menu}
        >
          ⠿
        </button>
      )}
      {menu && onMoveTo && (
        <div className="pf-card absolute right-1 top-9 z-20 flex w-40 flex-col gap-1 border border-line bg-background p-2 text-xs shadow">
          <button className={corner} onClick={() => (onMoveTo('start'), setMenu(false))}>
            в начало
          </button>
          <button className={corner} onClick={() => (onMoveTo('end'), setMenu(false))}>
            в конец
          </button>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (Number(before)) onMoveTo(Number(before))
              setMenu(false)
            }}
          >
            <input
              className="w-16 rounded border border-line px-1"
              inputMode="numeric"
              placeholder="перед №"
              aria-label="поставить перед карточкой номер"
              value={before}
              onChange={(e) => setBefore(e.target.value)}
            />
            <button className={corner} type="submit">
              ок
            </button>
          </form>
        </div>
      )}
      {(onCopy || onTrash || onErase) && (
        <div className="absolute left-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onCopy && (
            <button className={corner} onClick={onCopy} title="Копия последней версии — рядом, с отметкой «от №…»">
              копия
            </button>
          )}
          {onTrash && (
            <button className={corner} onClick={onTrash} title="В корзину: 30 дней можно вернуть">
              удалить
            </button>
          )}
          {onErase && (
            <button className={corner} onClick={onErase} title="Зашквар: насовсем сразу, мимо корзины, с причиной">
              насовсем
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** «+»: выбрать изделие с кадрами и его цвет — дальше открывается работа. */
function CreateDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (colourModelId: number, colourCode: string) => void
}) {
  const tree = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue, enabled: open })
  const palette = useQuery({ queryKey: ['palette'], queryFn: fetchPalette, enabled: open })
  const models = (tree.data ?? []).flatMap(modelsOf)
  const colourOf = (code: string) => palette.data?.colors.find((c) => c.code === code)
  return (
    <Modal open={open} onClose={onClose} title="Новый референс">
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
                  onClick={() => onPick(cm.id, cm.colour_code)}
                  className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
                  title={m.can_work ? `начать работу: ${colour?.name ?? cm.colour_code}` : (m.reason ?? '')}
                >
                  <span
                    className="mr-1 inline-block h-3 w-3 rounded-sm border border-line align-middle"
                    style={{ background: colour ? toCss(colour) : undefined }}
                  />
                  {/* Группа палитры по-русски — как в матрице дропа; код Cosmic — в подсказке. */}
                  {colour?.group ?? cm.colour_code}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </Modal>
  )
}

function modelsOf(node: TreeNode): TreeNode['models'] {
  return [...node.models, ...node.children.flatMap(modelsOf)]
}

/**
 * Поиск по витрине (US-0493): свои теги первыми, затем надпись дословно,
 * затем картинки по весам (план 071), — порядок решает сервис. Возвращает
 * номера референсов по порядку; null — не ищем, показывается всё.
 *
 * С задержкой: запрос на каждую букву — это «с», «сн», «сне» в сервис, из
 * которых нужен последний.
 */
function useFound(query: string): { ids: number[] | null; why: Map<number, string[]>; error: string | null } {
  const [ids, setIds] = useState<number[] | null>(null)
  const [why, setWhy] = useState<Map<number, string[]>>(new Map())
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setIds(null)
      setError(null)
      return
    }
    let stale = false
    const t = setTimeout(() => {
      findReferences(q)
        .then((rows) => {
          if (stale) return
          setIds(rows.map((r) => r.id))
          setWhy(new Map(rows.map((r) => [r.id, r.reasons])))
          setError(null)
        })
        .catch((e: Error) => !stale && setError(`Поиск не ответил: ${e.message}`))
    }, 350)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [query])
  return { ids, why, error }
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
