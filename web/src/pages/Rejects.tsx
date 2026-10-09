// Брак референсов (US-0885): решение «не берём», не удаление. Своим разделом,
// как корзина: что, кто, когда, почему; «вернуть в работу» отсюда. С витрины
// забракованных нет — иначе учили бы искать их в корзине.

import { DataTable, EmptyState, Modal, PageHeader, buttonClass, type DataColumn } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { meaningClass } from '../candidates/meaning'
import { listRejected, step, type Rejected } from '../shared/api/references'

export function Rejects() {
  const rejects = useQuery({ queryKey: ['references', 'rejected'], queryFn: listRejected })
  const queries = useQueryClient()
  const [reviving, setReviving] = useState<Rejected | null>(null)
  const [why, setWhy] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = () => queries.invalidateQueries({ queryKey: ['references'] })
  const act = (run: () => Promise<unknown>) =>
    run()
      .then(() => {
        setError(null)
        return refresh()
      })
      .catch((e: Error) => setError(`${e.message} — повторите; если повторится, сервис не отвечает.`))

  const columns: DataColumn<Rejected>[] = [
    {
      id: 'name',
      header: 'референс',
      width: 'w-72',
      cell: (r) => (
        <span className="truncate">
          №{r.id} · {r.name}
        </span>
      ),
    },
    {
      id: 'who',
      header: 'кто',
      cell: (r) => r.rejected_by_name || '—',
    },
    {
      id: 'when',
      header: 'когда',
      cell: (r) =>
        new Date(r.rejected_at).toLocaleString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    {
      id: 'why',
      header: 'почему',
      cell: (r) => <span className="truncate">{r.reason || '—'}</span>,
    },
    {
      id: 'actions',
      header: '',
      sortable: false,
      width: 'w-48',
      cell: (r) => (
        <button
          className={meaningClass('agree', true)}
          onClick={() => {
            setWhy('')
            setReviving(r)
          }}
        >
          вернуть в работу
        </button>
      ),
    },
  ]

  return (
    <main className="p-4">
      <PageHeader
        title="Брак"
        description="забракованные с причиной; вернуть в работу — снова на витрине. Не путать с корзиной"
      />
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      {rejects.isError ? (
        <EmptyState
          title="Брак не пришёл"
          description="Сервис не ответил. Обновите страницу; если повторится — стенд сервиса не поднят."
        />
      ) : (
        <DataTable
          rows={rejects.data ?? []}
          columns={columns}
          rowKey={(r) => String(r.id)}
          isLoading={rejects.isPending}
          empty="Брака нет — забракованные с витрины и из окна попадают сюда."
        />
      )}
      <Modal
        open={reviving !== null}
        onClose={() => setReviving(null)}
        title="Вернуть в работу?"
        actions={
          <>
            <button className={buttonClass({ tone: 'neutral', variant: 'outline' })} onClick={() => setReviving(null)}>
              оставить в браке
            </button>
            <button
              className={buttonClass({ tone: 'accent', variant: 'solid' })}
              disabled={!why.trim()}
              onClick={() => {
                const r = reviving
                const comment = why.trim()
                setReviving(null)
                if (r) void act(() => step(r.id, 'revive', comment))
              }}
            >
              вернуть в работу
            </button>
          </>
        }
      >
        {reviving && (
          <label className="block text-sm">
            почему возвращаете
            <textarea
              className="mt-1 w-full rounded border border-border bg-background p-2"
              rows={3}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="причина видна в пути согласования"
            />
          </label>
        )}
      </Modal>
    </main>
  )
}
