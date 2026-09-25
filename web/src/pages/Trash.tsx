// Корзина референсов (US-0494, решение 0014): удалённое 30 дней возвращается
// целиком, с историей, потом стирается само. Стереть раньше срока — отдельная
// функция «очистить корзину», с подтверждением. Картинки при этом остаются в
// библиотеке: их берут другие референсы.

import { DataTable, EmptyState, Modal, PageHeader, buttonClass, type DataColumn } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { CODE } from '../app/shell'
import { useCan } from '../shared/api/platform'
import { eraseReference, listTrash, restoreReference, type Trashed } from '../shared/api/references'

const DAY = 24 * 60 * 60 * 1000

/** «удалится через 12 дней»: срок словами, а не датой — дату пересчитывают в уме. */
function left(purgeAt: string): string {
  const days = Math.max(0, Math.ceil((new Date(purgeAt).getTime() - Date.now()) / DAY))
  if (days === 0) return 'удалится сегодня'
  const word = days % 10 === 1 && days % 100 !== 11 ? 'день' : [2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100) ? 'дня' : 'дней'
  return `удалится через ${days} ${word}`
}

export function Trash() {
  const trash = useQuery({ queryKey: ['references', 'trash'], queryFn: listTrash })
  const queries = useQueryClient()
  const canErase = useCan(CODE, 'references', 'purge-trash')
  const [erasing, setErasing] = useState<Trashed | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => queries.invalidateQueries({ queryKey: ['references'] })
  const act = (run: () => Promise<void>) =>
    run()
      .then(() => {
        setError(null)
        return refresh()
      })
      .catch((e: Error) => setError(`${e.message} — повторите; если повторится, сервис не отвечает.`))

  const columns: DataColumn<Trashed>[] = [
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
      id: 'deleted',
      header: 'удалён',
      cell: (r) => new Date(r.deleted_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    },
    { id: 'left', header: 'срок', cell: (r) => left(r.purge_at) },
    {
      id: 'actions',
      header: '',
      sortable: false,
      width: 'w-64',
      cell: (r) => (
        <span className="flex gap-2">
          <button className={buttonClass({ tone: 'accent', variant: 'outline', small: true })} onClick={() => void act(() => restoreReference(r.id))}>
            восстановить
          </button>
          {canErase && (
            <button className={buttonClass({ tone: 'danger', variant: 'outline', small: true })} onClick={() => setErasing(r)}>
              удалить насовсем
            </button>
          )}
        </span>
      ),
    },
  ]

  return (
    <main className="p-4">
      <PageHeader title="Корзина" description="удалённое возвращается целиком, с историей; через 30 дней стирается само" />
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      {trash.isError ? (
        <EmptyState title="Корзина не пришла" description="Сервис не ответил. Обновите страницу; если повторится — стенд сервиса не поднят." />
      ) : (
        <DataTable
          rows={trash.data ?? []}
          columns={columns}
          rowKey={(r) => String(r.id)}
          isLoading={trash.isPending}
          pagination="off"
          empty="Корзина пуста — удалённое с витрины попадает сюда на 30 дней."
        />
      )}
      <Modal
        open={erasing !== null}
        onClose={() => setErasing(null)}
        title="Удалить насовсем?"
        actions={
          <>
            <button className={buttonClass({ tone: 'neutral', variant: 'outline' })} onClick={() => setErasing(null)}>
              оставить в корзине
            </button>
            <button
              className={buttonClass({ tone: 'danger', variant: 'solid' })}
              onClick={() => {
                const r = erasing
                setErasing(null)
                if (r) void act(() => eraseReference(r.id))
              }}
            >
              удалить насовсем
            </button>
          </>
        }
      >
        {erasing &&
          `Референс №${erasing.id} «${erasing.name}» сотрётся со всей историей, вернуть его будет нельзя. Картинки, из которых он собран, останутся в библиотеке.`}
      </Modal>
    </main>
  )
}
