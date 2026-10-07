// Страница «Тексты» (US-0496): какие надписи уже были и где — чтобы не
// повторить прошлогоднее или, наоборот, взять удачное. Строка на надпись:
// написание, шрифты, в скольких референсах. Поиск по словам, а не по весам:
// «ЛЕТО 2025» находит и «ЛЕТО 2024» — похожим, с отметкой (решение 0010).
// Надпись можно завести заранее, под будущий дроп.

import { Checkbox, DataTable, EmptyState, PageHeader, TextInput, buttonClass, type DataColumn } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CODE } from '../app/shell'
import { AssignBar, DropFilterBar } from '../candidates/DropFilter'
import { passes, useDropFilter } from '../shared/filters'
import { useCan } from '../shared/api/platform'
import { fetchTexts, linkTexts, planText, type TextRow } from '../shared/api/texts'
import { voteLibrary } from '../shared/api/assets'
import { Viewer } from '../candidates/Viewer'
import { Votes } from '../candidates/Votes'

const MATCH: Record<string, string> = { same: 'дословно', words: 'все слова', close: 'похоже' }

export function Texts() {
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const texts = useQuery({ queryKey: ['texts', asked], queryFn: () => fetchTexts(asked) })
  const queries = useQueryClient()
  const navigate = useNavigate()
  const canPlan = useCan(CODE, 'texts', 'write')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const drop = useDropFilter()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const shown = (texts.data ?? []).filter((r) =>
    passes({ drops: r.drops.map((d) => d.id), audiences: r.audiences.map((a) => a.code), categories: r.categories }, drop.filter),
  )

  const [opened, setOpened] = useState<string | null>(null)
  const openedAt = shown.findIndex((r) => r.key === opened)
  function vote(key: string, value: -1 | 0 | 1) {
    voteLibrary('texts', key, value)
      .then(() => queries.invalidateQueries({ queryKey: ['texts'] }))
      .catch((e: Error) => setError(`${e.message} — повторите.`))
  }

  function assign(what: { drop_id?: number; audience?: string }) {
    linkTexts({ keys: [...picked], ...what })
      .then(() => {
        setPicked(new Set())
        return queries.invalidateQueries({ queryKey: ['texts'] })
      })
      .catch((e: Error) => setError(`${e.message} — повторите.`))
  }

  // Запрос на каждую букву ни к чему: ищем, когда рука остановилась.
  useEffect(() => {
    const t = setTimeout(() => setAsked(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  function plan() {
    const text = draft.trim()
    if (!text) return
    planText(text)
      .then(() => {
        setDraft('')
        setError(null)
        return queries.invalidateQueries({ queryKey: ['texts'] })
      })
      .catch((e: Error) => setError(`Не завелась: ${e.message} — повторите.`))
  }

  const columns: DataColumn<TextRow>[] = [
    {
      id: 'pick',
      header: '',
      sortable: false,
      width: 'w-10',
      cell: (r) => (
        <Checkbox
          label=""
          aria-label={`выбрать «${r.text}»`}
          checked={picked.has(r.key)}
          onChange={(on) =>
            setPicked((s) => {
              const next = new Set(s)
              if (on) next.add(r.key)
              else next.delete(r.key)
              return next
            })
          }
        />
      ),
    },
    {
      id: 'text',
      header: 'надпись',
      width: 'w-80',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <button
            className="text-left font-semibold hover:underline"
            style={r.fonts[0] ? { fontFamily: `"${r.fonts[0]}", sans-serif` } : undefined}
            onClick={() => setOpened(r.key)}
            title="Открыть крупно"
          >
            {r.text}
          </button>
          {r.match && (
            <span className="rounded bg-tone-amber-soft px-1.5 text-xs" title={r.similarity !== null ? `похожесть ${r.similarity}` : undefined}>
              {MATCH[r.match] ?? r.match}
              {r.match === 'close' && r.similarity !== null && ` ${Math.round(r.similarity * 100)}%`}
            </span>
          )}
          {r.planned && <span className="rounded bg-tone-blue-soft px-1.5 text-xs">заведена заранее</span>}
          {drop.filter.drop !== null &&
            r.drops
              .filter((d) => d.id === drop.filter.drop)
              .map((d) => (
                <span key={d.id} className="text-xs text-muted-foreground">
                  {d.via === null
                    ? { proposed: 'предложена', approved: 'одобрена', rejected: `не одобрена — «${d.reason}»` }[d.status ?? 'proposed']
                    : `через референс №${d.via}`}
                </span>
              ))}
        </span>
      ),
    },
    { id: 'fonts', header: 'шрифты', cell: (r) => (r.fonts.length ? r.fonts.join(', ') : '—') },
    {
      id: 'votes',
      header: 'оценка',
      width: 'w-28',
      sortable: false,
      cell: (r) => <Votes votes={r.votes} onVote={(v) => vote(r.key, v)} />,
    },
    {
      id: 'refs',
      header: 'референсов',
      width: 'w-64',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <span className="tabular-nums">{r.references.length}</span>
          {r.references.map((c) => (
            <button
              key={c.id}
              className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
              onClick={() => navigate(`/references/${c.id}`)}
              title={c.name}
            >
              №{c.id}
            </button>
          ))}
        </span>
      ),
    },
  ]

  return (
    <main className="p-4">
      <PageHeader
        title="Тексты"
        description={asked ? `по словам «${asked}» — ${texts.data?.length ?? 0}` : 'надписи из референсов и заведённые заранее'}
        actions={
          <div className="flex items-center gap-2">
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="лето, 2025…" aria-label="поиск надписи по словам" />
            {canPlan && (
              <>
                <TextInput
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && plan()}
                  placeholder="С НОВЫМ 2027"
                  aria-label="завести надпись заранее"
                />
                <button className={buttonClass({ tone: 'accent', variant: 'outline' })} onClick={plan} disabled={!draft.trim()}>
                  завести
                </button>
              </>
            )}
          </div>
        }
      />
      <DropFilterBar {...drop} />
      <AssignBar selected={picked.size} noun={['надпись', 'надписи', 'надписей']} onAssign={assign} onClear={() => setPicked(new Set())} />
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      {texts.isError ? (
        <EmptyState title="Тексты не пришли" description="Сервис не ответил. Обновите страницу; если повторится — стенд сервиса не поднят." />
      ) : (
        <DataTable
          rows={shown}
          columns={columns}
          rowKey={(r) => r.text}
          isLoading={texts.isPending}
          empty={
            asked
              ? 'Такой надписи не было — ни дословно, ни похожей. Можно завести её заранее.'
              : 'Надписей пока нет: они появятся из сохранённых референсов, или заведите слоган заранее.'
          }
        />
      )}
      {openedAt >= 0 && (
        <TextViewer
          row={shown[openedAt]}
          at={openedAt}
          total={shown.length}
          onMove={(to) => setOpened(shown[to].key)}
          onVote={(v) => vote(shown[openedAt].key, v)}
          onClose={() => setOpened(null)}
        />
      )}
    </main>
  )
}

const DROP_STATUS: Record<string, string> = { proposed: 'предложена', approved: 'одобрена', rejected: 'не одобрена' }

/** Надпись крупно (US-0715): каждым её шрифтом, где стоит, дропы, голоса. */
function TextViewer({
  row,
  at,
  total,
  onMove,
  onVote,
  onClose,
}: {
  row: TextRow
  at: number
  total: number
  onMove: (to: number) => void
  onVote: (value: -1 | 0 | 1) => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const fonts = row.fonts.length ? row.fonts : [null]
  return (
    <Viewer
      label={`надпись ${row.text}`}
      title={row.text}
      at={at}
      total={total}
      onMove={onMove}
      onClose={onClose}
      tools={<Votes votes={row.votes} onVote={onVote} large />}
    >
      <div className="flex min-h-0 w-full">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto bg-muted p-6">
          {fonts.map((f) => (
            <figure key={f ?? 'none'} className="text-center">
              <div className="break-words text-6xl font-semibold" style={f ? { fontFamily: `"${f}", sans-serif` } : undefined}>
                {row.text}
              </div>
              <figcaption className="mt-2 text-xs text-muted-foreground">{f ?? 'шрифт ещё не выбран — надпись заведена заранее'}</figcaption>
            </figure>
          ))}
        </div>
        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-line p-3 text-sm">
          {row.planned && <div className="text-xs text-muted-foreground">заведена заранее, в референсах её ещё нет</div>}
          <div className="text-xs">
            <div className="text-muted-foreground">дропы:</div>
            {row.drops.length === 0 && <div className="text-muted-foreground">ни в одном</div>}
            {row.drops.map((d) => (
              <div key={d.id}>
                {d.name} — {d.via === null ? DROP_STATUS[d.status ?? 'proposed'] + (d.reason ? ` («${d.reason}»)` : '') : `через референс №${d.via}`}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">где стоит:</span>
            {row.references.length === 0 && <span className="text-muted-foreground">нигде</span>}
            {row.references.map((c) => (
              <button
                key={c.id}
                className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
                onClick={() => {
                  onClose()
                  navigate(`/references/${c.id}`, { state: { inApp: true } })
                }}
                title={c.name}
              >
                №{c.id}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Viewer>
  )
}
