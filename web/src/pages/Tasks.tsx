// «Мои задачи» (US-0510): что ждёт именно меня и что я отдал и жду от других.
// Собирается сервисом вычислением из статусов и ролей (И-8), а не полем
// «ответственный»: кто первым из редакторов решил — у остальных задача
// пропадает сама.

import { EmptyState, Hint, PageHeader, Tabs } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ReferenceCard } from '../candidates/ReferenceCard'
import { meaningClass } from '../candidates/meaning'
import {
  dropAccidental,
  dropDraft,
  fetchMyDrafts,
  fetchTasks,
  closeMeeting,
  fetchAgenda,
  type AgendaEvent,
  listReferences,
  STATUS_NAMES,
  type Card,
  type MyDraft,
  type Task,
} from '../shared/api/references'
import { prefetchCard, rememberDraft } from '../shared/cardCache'
import { forgetBuffer } from '../shared/draftWriter'

type TabId = 'mine' | 'waiting' | 'drafts' | 'agenda'

/** «Согласование» — один раздел, внутри вкладки (US-0687): что ждёт меня,
 *  что я отдал, где у меня несохранённое. Вкладка — в адресе (`?tab=`):
 *  ссылка и возврат из окна приходят на неё же. Не выбрана — та, где что-то
 *  ждёт меня, иначе первая. */
export function Tasks() {
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, refetchInterval: 15_000 })
  const drafts = useQuery({ queryKey: ['my-drafts'], queryFn: fetchMyDrafts, refetchOnWindowFocus: true })
  const agenda = useQuery({ queryKey: ['agenda-page', null], queryFn: () => fetchAgenda(null) })
  const agendaCount = agenda.data
    ? agenda.data.proposed.length + agenda.data.approved.length + agenda.data.rework.length + agenda.data.rejected.length + agenda.data.undone.length
    : undefined
  const [params, setParams] = useSearchParams()
  const counts = { mine: tasks.data?.mine.length, waiting: tasks.data?.waiting.length, drafts: drafts.data?.length, agenda: agendaCount }
  const asked = params.get('tab') as TabId | null
  const tab: TabId =
    asked && asked in counts ? asked : counts.mine ? 'mine' : counts.waiting ? 'waiting' : counts.drafts ? 'drafts' : 'mine'
  return (
    <div className="p-4">
      <PageHeader title="Согласование" description="Что ждёт вас, что вы отдали и где у вас несохранённое." />
      {tasks.isError && <p className="text-sm text-destructive">{(tasks.error as Error).message}</p>}
      <Tabs
        label="Согласование"
        current={tab}
        onPick={(id) => setParams((p) => ({ ...Object.fromEntries(p), tab: id }), { replace: true })}
        items={[
          { id: 'mine', label: 'Ждёт меня', count: counts.mine },
          { id: 'waiting', label: 'Отдал — жду', count: counts.waiting },
          { id: 'drafts', label: 'Мои черновики', count: counts.drafts },
          { id: 'agenda', label: 'Повестка', count: counts.agenda },
        ]}
      >
        {tab === 'agenda' ? (
          <AgendaTab />
        ) : tab === 'drafts' ? (
          <MyDrafts />
        ) : tasks.isPending ? (
          <p className="text-sm text-muted-foreground">Загружаю задачи…</p>
        ) : tab === 'mine' ? (
          <TaskList rows={tasks.data?.mine ?? []} empty="Сейчас ваш ход нигде не нужен." />
        ) : (
          <TaskList rows={tasks.data?.waiting ?? []} empty="Ничего не ждёт решения других." />
        )}
      </Tabs>
    </div>
  )
}

/** Сетка карточек, как на витрине (US-0688): референс узнают по картинке,
 *  а не по строке с номером. */
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {children}
    </div>
  )
}

/** Карточки витрины по номерам — из того же списка, что и витрина. */
function useCards(): Map<number, Card> {
  const cards = useQuery({ queryKey: ['references'], queryFn: listReferences })
  return new Map((cards.data ?? []).map((c) => [c.id, c]))
}

function TaskList({ rows, empty }: { rows: Task[]; empty: string }) {
  const cards = useCards()
  const open = useOpen()
  if (rows.length === 0) return <EmptyState title="Пусто" description={empty} />
  return (
    <Grid>
      {rows.map((t) => {
        const card = cards.get(t.id)
        const why = t.reason === STATUS_NAMES[t.status] ? t.reason : `${STATUS_NAMES[t.status]} — ${t.reason}`
        // Статус карточка пишет сама; причина — только если она что-то добавляет.
        const note = t.reason === STATUS_NAMES[t.status] ? undefined : [{ text: t.reason, tone: t.status === 'rework' ? ('warning' as const) : ('muted' as const) }]
        return card ? (
          <div key={t.id} className="grid h-64 min-w-0">
            <ReferenceCard card={card} note={note} onOpen={() => open(t.id)} onHover={open.warm(t.id)} />
          </div>
        ) : (
          <Link key={t.id} to={`/references/${t.id}`} state={{ inApp: true }} className="pf-card h-64 border border-line p-2 text-sm">
            №{t.id} · {t.name}
            <div className="text-xs text-muted-foreground">{why}</div>
          </Link>
        )
      })}
    </Grid>
  )
}

/** Открыть окно поверх согласования: крестик вернёт на ту же вкладку. */
function useOpen() {
  const navigate = useNavigate()
  const queries = useQueryClient()
  const open = (id: number) => navigate(`/references/${id}`, { state: { inApp: true } })
  open.warm = (id: number) => () => prefetchCard(queries, id)
  return open
}

/** Мои черновики (US-0685): где у меня несохранённое и что в нём — словами.
 *  Мелкое помечено «похоже на случайное»: задел мышью, пока листал. Выбросить
 *  — работа снова как в версии; сама версия не меняется. */
function MyDrafts() {
  const queries = useQueryClient()
  const drafts = useQuery({ queryKey: ['my-drafts'], queryFn: fetchMyDrafts, refetchOnWindowFocus: true })
  const [error, setError] = useState<string | null>(null)
  const cards = useCards()
  const open = useOpen()
  const navigate = useNavigate()
  const rows = drafts.data ?? []
  const accidental = rows.filter((d) => d.accidental && d.reference_id !== null)
  const forget = (ids: (number | null)[]) => {
    for (const id of ids) {
      forgetBuffer(id)
      if (id !== null) rememberDraft(queries, id, null)
    }
    void queries.invalidateQueries({ queryKey: ['my-drafts'] })
    void queries.invalidateQueries({ queryKey: ['references'] })
  }
  const run = (p: Promise<unknown>) =>
    void p.then(() => setError(null)).catch((e: Error) => setError(`${e.message} — повторите.`))
  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        {accidental.length > 0 && (
          <button className={meaningClass('withdraw', true)} onClick={() => run(dropAccidental().then(forget))}
          >
            выбросить похожие на случайное · {accidental.length}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {drafts.isError && <p className="text-sm text-destructive">{(drafts.error as Error).message}</p>}
      {drafts.data && rows.length === 0 && (
        <EmptyState title="Пусто" description="Несохранённого нигде нет: всё, что правили, — в версиях." />
      )}
      <Grid>
        {rows.map((d) => (
          <DraftCard key={d.reference_id ?? 'new'} d={d} card={d.reference_id === null ? undefined : cards.get(d.reference_id)}
            onOpen={() => (d.reference_id === null ? navigate('/references/new', { state: { inApp: true } }) : open(d.reference_id))}
            onDrop={() => run(dropDraft(d.reference_id).then(() => forget([d.reference_id])))} />
        ))}
      </Grid>
    </section>
  )
}

function DraftCard({ d, card, onOpen, onDrop }: { d: MyDraft; card?: Card; onOpen: () => void; onDrop: () => void }) {
  const when = new Date(d.updated_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const note = [
    ...(d.accidental ? [{ text: 'похоже на случайное', tone: 'warning' as const }] : []),
    { text: d.changes.join('; ') },
    { text: `правлено ${when}${d.base_number ? ` · поверх версии ${d.base_number}` : ''}` },
  ]
  if (card) return (
    <div className="grid h-64 min-w-0">
      <ReferenceCard card={card} note={note} onOpen={onOpen} onDiscard={onDrop} />
    </div>
  )
  return (
    <div className="pf-card relative flex h-64 flex-col border border-line p-2 text-xs">
      <button className="flex-1 text-left" onClick={onOpen}>
        <div className="font-semibold">{d.name}</div>
        {note.map((n) => (
          <div key={n.text} className={n.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}>
            {n.text}
          </div>
        ))}
      </button>
      <button className={meaningClass('withdraw', true)} onClick={onDrop}>
        выбросить
      </button>
    </div>
  )
}

/** Повестка встречи (план 097): с прошлой встречи — выдвинутое на
 *  обсуждение первым, затем решения из пути по версиям. «Встреча прошла» —
 *  выдвинутое обсуждено, следующая повестка начинается с этого момента.
 *  Прошлые встречи — как было на каждой (?meeting=N в адресе). */
function AgendaTab() {
  const queries = useQueryClient()
  const [params, setParams] = useSearchParams()
  const meeting = params.get('meeting') ? Number(params.get('meeting')) : null
  const agenda = useQuery({ queryKey: ['agenda-page', meeting], queryFn: () => fetchAgenda(meeting) })
  const cards = useCards()
  const open = useOpen()
  const [error, setError] = useState<string | null>(null)
  const when = (at: string) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const pick = (id: number | null) =>
    setParams((p) => {
      const next = Object.fromEntries(p)
      if (id) next.meeting = String(id)
      else delete next.meeting
      return next
    }, { replace: true })
  const a = agenda.data
  if (agenda.isError) return <p className="text-sm text-destructive">{(agenda.error as Error).message}</p>
  if (!a) return <p className="text-sm text-muted-foreground">Собираю повестку…</p>
  const events = (title: string, rows: AgendaEvent[], verb: string) =>
    rows.length > 0 && (
      <section className="mb-4">
        <h2 className="mb-1 text-sm font-semibold">{title} · {rows.length}</h2>
        <Grid>
          {rows.map((e, i) => {
            const card = cards.get(e.reference_id)
            const note = [{ text: `${verb}: ${e.by_name ?? 'без входа'}, ${when(e.at)}` }, ...(e.comment ? [{ text: `«${e.comment}»`, tone: 'warning' as const }] : [])]
            return card ? (
              <div key={`${e.reference_id}-${i}`} className="grid h-64 min-w-0">
                <ReferenceCard card={card} note={note} onOpen={() => open(e.reference_id)} onHover={open.warm(e.reference_id)} />
              </div>
            ) : null
          })}
        </Grid>
      </section>
    )
  const empty = a.proposed.length + a.approved.length + a.rework.length + a.rejected.length + a.undone.length === 0
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {a.meeting
            ? `встреча ${when(a.meeting.held_at)}${a.meeting.by_name ? ` · закрыл ${a.meeting.by_name}` : ''}`
            : a.since
              ? `с прошлой встречи — ${when(a.since)}`
              : 'встреч ещё не было — всё с начала'}
        </span>
        {!a.meeting && (
          <Hint text="Выдвинутое станет обсуждённым и снимется с карточек; следующая повестка начнётся с этого момента">
            <button
              className={meaningClass('act', true, true)}
              onClick={() =>
                void closeMeeting()
                  .then(() => {
                    setError(null)
                    void queries.invalidateQueries({ queryKey: ['agenda-page'] })
                    void queries.invalidateQueries({ queryKey: ['references'] })
                  })
                  .catch((e: Error) => setError(e.message))
              }
            >
              встреча прошла
            </button>
          </Hint>
        )}
        {a.meetings.length > 0 && <span className="ml-2 text-xs text-muted-foreground">прошлые встречи:</span>}
        <button className={meaningClass('quiet', true, true)} aria-pressed={meeting === null} onClick={() => pick(null)}>
          текущая
        </button>
        {a.meetings.slice(0, 8).map((m) => (
          <button key={m.id} className={meaningClass('quiet', true, true)} aria-pressed={meeting === m.id} onClick={() => pick(m.id)}>
            {when(m.held_at)}
          </button>
        ))}
      </div>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      {empty && <EmptyState title="Пусто" description={a.meeting ? 'На этой встрече обсуждать было нечего.' : 'С прошлой встречи ничего не выдвинули и не решили.'} />}
      {a.proposed.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-1 text-sm font-semibold">Выдвинуто на обсуждение · {a.proposed.length}</h2>
          <Grid>
            {a.proposed.map((p) => {
              const card = cards.get(p.reference_id)
              const note = p.reasons.map((r) => ({ text: `${r.by_name ?? 'без входа'}: ${r.reason}`, tone: 'warning' as const }))
              return card ? (
                <div key={p.reference_id} className="grid h-64 min-w-0">
                  <ReferenceCard card={card} note={note} onOpen={() => open(p.reference_id)} onHover={open.warm(p.reference_id)} />
                </div>
              ) : null
            })}
          </Grid>
        </section>
      )}
      {events('Согласовано', a.approved, 'согласовал')}
      {events('На доработку', a.rework, 'вернул')}
      {events('Забраковано', a.rejected, 'забраковал')}
      {events('Отозвано и отменено', a.undone, 'отменил')}
    </div>
  )
}
