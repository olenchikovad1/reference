// «Мои задачи» (US-0510): что ждёт именно меня и что я отдал и жду от других.
// Собирается сервисом вычислением из статусов и ролей (И-8), а не полем
// «ответственный»: кто первым из редакторов решил — у остальных задача
// пропадает сама.

import { buttonClass, EmptyState, PageHeader, Tabs } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { dropAccidental, dropDraft, fetchMyDrafts, fetchTasks, STATUS_NAMES, type MyDraft, type Task } from '../shared/api/references'
import { rememberDraft } from '../shared/cardCache'
import { forgetBuffer } from '../shared/draftWriter'

type TabId = 'mine' | 'waiting' | 'drafts'

/** «Согласование» — один раздел, внутри вкладки (US-0687): что ждёт меня,
 *  что я отдал, где у меня несохранённое. Вкладка — в адресе (`?tab=`):
 *  ссылка и возврат из окна приходят на неё же. Не выбрана — та, где что-то
 *  ждёт меня, иначе первая. */
export function Tasks() {
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, refetchInterval: 15_000 })
  const drafts = useQuery({ queryKey: ['my-drafts'], queryFn: fetchMyDrafts, refetchOnWindowFocus: true })
  const [params, setParams] = useSearchParams()
  const counts = { mine: tasks.data?.mine.length, waiting: tasks.data?.waiting.length, drafts: drafts.data?.length }
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
        ]}
      >
        {tab === 'drafts' ? (
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

function TaskList({ rows, empty }: { rows: Task[]; empty: string }) {
  return (
    <section>
      {rows.length === 0 && <EmptyState title="Пусто" description={empty} />}
      <div className="flex flex-col gap-1">
        {rows.map((t) => (
          <Link key={t.id} to={`/references/${t.id}`} state={{ inApp: true }} className="rounded border border-line px-2 py-1 text-sm hover:bg-hover">
            №{t.id} · {t.name}
            <span className="ml-2 text-xs text-muted-foreground">
              {t.reason === STATUS_NAMES[t.status] ? t.reason : `${STATUS_NAMES[t.status]} — ${t.reason}`}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

/** Мои черновики (US-0685): где у меня несохранённое и что в нём — словами.
 *  Мелкое помечено «похоже на случайное»: задел мышью, пока листал. Выбросить
 *  — работа снова как в версии; сама версия не меняется. */
function MyDrafts() {
  const queries = useQueryClient()
  const drafts = useQuery({ queryKey: ['my-drafts'], queryFn: fetchMyDrafts, refetchOnWindowFocus: true })
  const [error, setError] = useState<string | null>(null)
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
          <button
            className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
            onClick={() => run(dropAccidental().then(forget))}
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
      <div className="flex flex-col gap-1">
        {rows.map((d) => (
          <DraftRow key={d.reference_id ?? 'new'} d={d} onDrop={() => run(dropDraft(d.reference_id).then(() => forget([d.reference_id])))} />
        ))}
      </div>
    </section>
  )
}

function DraftRow({ d, onDrop }: { d: MyDraft; onDrop: () => void }) {
  const when = new Date(d.updated_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="flex items-start gap-2 rounded border border-line px-2 py-1 text-sm">
      <div className="flex-1">
        <Link to={d.reference_id === null ? '/references/new' : `/references/${d.reference_id}`} state={{ inApp: true }} className="hover:underline">
          {d.reference_id === null ? 'Новая работа' : `№${d.reference_id} · ${d.name}`}
        </Link>
        <span className="ml-2 text-xs text-muted-foreground">
          {when}
          {d.base_number ? ` · поверх версии ${d.base_number}` : ''}
        </span>
        {d.accidental && <span className="ml-2 rounded bg-warning/15 px-1 text-xs text-warning">похоже на случайное</span>}
        <div className="text-xs text-muted-foreground">{d.changes.join('; ')}</div>
      </div>
      <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={onDrop}>
        выбросить
      </button>
    </div>
  )
}
