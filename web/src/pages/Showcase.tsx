// Витрина референсов (US-0491): работы карточками — изделие спереди и сзади,
// а не список имён. Три строки при любой высоте окна, столбцов — сколько
// помещается, остальное листается вбок. Первая карточка — «+»: новый референс
// начинается отсюда, выбором изделия и цвета.
//
// Картинки карточек — снимки, сделанные при сохранении (views версии), а не
// отрисовка на лету: шестьдесят карточек не должны рисовать сто двадцать
// изделий.

import { EmptyState, Modal, PageHeader, TextInput, buttonClass } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { CODE } from '../app/shell'
import { warmGarments } from '../candidates/GarmentCanvas'
import { frameUrl, productQuery } from '../shared/api/products'
import { DropFilterBar } from '../candidates/DropFilter'
import { passes, useDropFilter } from '../shared/filters'
import { useCan } from '../shared/api/platform'

import { assetUrl } from '../shared/api/assets'
import { fetchPalette, toCss } from '../shared/api/colours'
import { fetchCatalogue, type TreeNode } from '../shared/api/drops'
import { copyReference, findReferences, listReferences, trashReference, type Card } from '../shared/api/references'

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
  const [trashing, setTrashing] = useState<Card | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const act = (run: () => Promise<unknown>) =>
    run()
      .then(() => {
        setActionError(null)
        return queries.invalidateQueries({ queryKey: ['references'] })
      })
      .catch((e: Error) => setActionError(`${e.message} — повторите; если повторится, сервис не отвечает.`))

  // В поиске — порядок совпадения (свой тег первым), без него — свежие первыми.
  const shown = (
    found.ids === null ? cards.data : found.ids.flatMap((id) => cards.data?.find((c) => c.id === id) ?? [])
  )?.filter((c) =>
    passes(
      { drops: c.drop_ids, audiences: c.audience ? [c.audience] : [], categories: c.category ? [c.category] : [] },
      drop.filter,
    ),
  )
  const rowHeight = Math.max(120, (height.value - GAP * (ROWS - 1)) / ROWS)

  /** Стрелки ходят по карточкам: вверх-вниз — в столбце, вбок — на столбец. */
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = [...(grid.current?.querySelectorAll<HTMLButtonElement>('[data-card]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    const by: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: ROWS, ArrowLeft: -ROWS }
    if (!(e.key in by)) return
    e.preventDefault()
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
            ? 'последние сохранённые первыми'
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
          {shown?.map((c) => (
            <ShowcaseCard
              key={c.id}
              card={c}
              onOpen={() => navigate(`/references/${c.id}`)}
              reasons={found.ids === null ? undefined : found.why.get(c.id)}
              onCopy={canCopy ? () => void act(() => copyReference(c.id)) : undefined}
              onTrash={canTrash ? () => setTrashing(c) : undefined}
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
function ShowcaseCard({
  card,
  onOpen,
  onCopy,
  onTrash,
  reasons,
}: {
  card: Card
  /** Почему найдена — при поиске (US-0498). */
  reasons?: string[]
  onOpen: () => void
  onCopy?: () => void
  onTrash?: () => void
}) {
  const front = card.views.front
  const back = card.views.back
  const corner = buttonClass({ tone: 'neutral', variant: 'outline', small: true })
  return (
    <div className="group relative flex min-h-0 flex-col">
    <button
      data-card
      onClick={onOpen}
      className="pf-card flex min-h-0 flex-1 flex-col overflow-hidden border border-line text-left"
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
        {reasons?.slice(0, 2).map((r) => (
          <div key={r} className="truncate text-primary" title={r}>
            {r}
          </div>
        ))}
      </div>
    </button>
      {(onCopy || onTrash) && (
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
