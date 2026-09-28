// «Мои задачи» (US-0510): что ждёт именно меня и что я отдал и жду от других.
// Собирается сервисом вычислением из статусов и ролей (И-8), а не полем
// «ответственный»: кто первым из редакторов решил — у остальных задача
// пропадает сама.

import { EmptyState, PageHeader } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { fetchTasks, STATUS_NAMES, type Task } from '../shared/api/references'

export function Tasks() {
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, refetchInterval: 15_000 })
  return (
    <div className="p-4">
      <PageHeader title="Мои задачи" description="Что ждёт вас в согласовании, и что вы отдали." />
      {tasks.isError && <p className="text-sm text-destructive">{(tasks.error as Error).message}</p>}
      {tasks.isPending && <p className="text-sm text-muted-foreground">Загружаю задачи…</p>}
      {tasks.data && (
        <div className="flex max-w-3xl flex-col gap-4">
          <TaskList title="Ждёт меня" rows={tasks.data.mine} empty="Сейчас ваш ход нигде не нужен." />
          <TaskList title="Отдал — жду" rows={tasks.data.waiting} empty="Ничего не ждёт решения других." />
        </div>
      )}
    </div>
  )
}

function TaskList({ title, rows, empty }: { title: string; rows: Task[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">
        {title} · {rows.length}
      </h2>
      {rows.length === 0 && <EmptyState title="Пусто" description={empty} />}
      <div className="flex flex-col gap-1">
        {rows.map((t) => (
          <Link key={t.id} to={`/references/${t.id}`} className="rounded border border-line px-2 py-1 text-sm hover:bg-hover">
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
