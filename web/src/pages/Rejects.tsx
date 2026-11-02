// Брак референсов (US-0885): решение «не берём», не удаление. Своим разделом,
// как корзина: что, кто, когда, почему; «вернуть в работу» отсюда. С витрины
// забракованных нет — иначе учили бы искать их в корзине.

import { DataTable, EmptyState, PageHeader, type DataColumn } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { meaningClass } from '../candidates/meaning'
import { ReviewDecisionModal } from '../candidates/ReviewDecisionModal'
import { listRejected, type Rejected } from '../shared/api/references'
import { useCan } from '../shared/api/platform'
import { CODE } from '../app/shell'

export function Rejects() {
  const rejects = useQuery({ queryKey: ['references', 'rejected'], queryFn: listRejected })
  const [reviving, setReviving] = useState<Rejected | null>(null)
  const canReview = useCan(CODE, 'review', 'write')

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
      cell: (r) => canReview && r.can_revive ? (
        <button
          className={meaningClass('agree', true)}
          onClick={() => setReviving(r)}
        >
          вернуть в работу
        </button>
      ) : null,
    },
  ]

  return (
    <main className="p-4">
      <PageHeader
        title="Брак"
        description="забракованные с причиной; вернуть в работу — снова на витрине. Не путать с корзиной"
      />
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
      <ReviewDecisionModal card={reviving} action="revive" onClose={() => setReviving(null)} onDone={() => setReviving(null)} />
    </main>
  )
}
