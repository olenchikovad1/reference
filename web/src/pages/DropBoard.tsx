// Доска дропа (US-0506): предложено / одобрено / не одобрено — принты и фразы.
// Статус — у элемента в этом дропе; решает тот, у кого функция одобрения,
// дизайнер предлагает, но сам себе не одобряет. У отказа причина обязательна,
// и отклонённое остаётся видно с ней. Попавшее в дроп через референс стоит
// отдельно — одобрения само по себе оно не получает.

import { buttonClass, TextInput } from '@platform/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CODE } from '../app/shell'
import { assetUrl } from '../shared/api/assets'
import { decide, fetchBoard, type BoardItem } from '../shared/api/drops'
import { useCan } from '../shared/api/platform'

const COLUMNS: { status: BoardItem['status']; title: string }[] = [
  { status: 'proposed', title: 'Предложено' },
  { status: 'approved', title: 'Одобрено' },
  { status: 'rejected', title: 'Не одобрено' },
]

const when = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

export function DropBoard({ dropId }: { dropId: number }) {
  const b = useQuery({ queryKey: ['drops', dropId, 'board'], queryFn: () => fetchBoard(dropId) })
  const queries = useQueryClient()
  const navigate = useNavigate()
  const canApprove = useCan(CODE, 'drops', 'approve-in-drop')
  const [rejecting, setRejecting] = useState<BoardItem | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function send(item: BoardItem, status: 'approved' | 'rejected', why?: string) {
    decide(dropId, { kind: item.kind, keys: [item.key], status, reason: why })
      .then(() => {
        setRejecting(null)
        setReason('')
        setError(null)
        return queries.invalidateQueries({ queryKey: ['drops', dropId, 'board'] })
      })
      .catch((e: Error) => setError(`${e.message} — повторите.`))
  }

  if (b.isError) return <p className="mt-4 text-sm">Доска дропа не пришла — обновите страницу.</p>
  const items = b.data?.items ?? []

  return (
    <section className="mt-6" aria-label="доска дропа">
      <h3 className="mb-1 text-base font-semibold">Принты и фразы в дропе</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        предлагают со страниц «Принты» и «Тексты»; {canApprove ? 'решаете вы — у отказа нужна причина' : 'решает редактор'}
      </p>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {COLUMNS.map((col) => (
          <div key={col.status} className="pf-card border border-line p-2">
            <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              {col.title} · {items.filter((i) => i.status === col.status).length}
            </h4>
            <div className="flex flex-col gap-2">
              {items
                .filter((i) => i.status === col.status)
                .map((i) => (
                  <article key={`${i.kind}-${i.key}`} className="rounded border border-line p-2 text-xs">
                    <div className="flex items-center gap-2">
                      {i.kind === 'image' ? (
                        <img src={assetUrl(i.key, 'thumb')} alt="" width={40} height={40} className="object-contain" />
                      ) : (
                        <span className="rounded bg-tone-blue-soft px-1.5">фраза</span>
                      )}
                      <strong className="min-w-0 flex-1 truncate" title={i.title}>
                        {i.title}
                      </strong>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      предложил {i.proposed_by_name ?? (i.proposed_by ? 'имя ещё не пришло' : 'без входа')}, {when(i.proposed_at)}
                    </div>
                    {i.decided_at && (
                      <div className="text-muted-foreground">
                        решил {i.decided_by_name ?? (i.decided_by ? 'имя ещё не пришло' : 'без входа')}, {when(i.decided_at)}
                      </div>
                    )}
                    {i.reason && <div className="mt-1">причина: «{i.reason}»</div>}
                    {canApprove && i.status !== 'approved' && (
                      <button className={buttonClass({ tone: 'accent', variant: 'outline', small: true })} onClick={() => send(i, 'approved')}>
                        одобрить
                      </button>
                    )}
                    {canApprove && i.status !== 'rejected' && rejecting?.key !== i.key && (
                      <button className={buttonClass({ tone: 'danger', variant: 'outline', small: true })} onClick={() => setRejecting(i)}>
                        не одобрить
                      </button>
                    )}
                    {rejecting?.key === i.key && rejecting.kind === i.kind && (
                      <div className="mt-1 flex gap-1">
                        <TextInput
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="почему — обязательно"
                          aria-label="причина отказа"
                          autoFocus
                        />
                        <button
                          className={buttonClass({ tone: 'danger', variant: 'solid', small: true })}
                          disabled={!reason.trim()}
                          onClick={() => send(i, 'rejected', reason.trim())}
                        >
                          не одобрить
                        </button>
                      </div>
                    )}
                  </article>
                ))}
            </div>
          </div>
        ))}
      </div>
      {(b.data?.via_references.length ?? 0) > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">В референсах дропа — без предложения</h4>
          <div className="flex flex-wrap gap-2">
            {b.data!.via_references.map((v) => (
              <span key={`${v.kind}-${v.key}`} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs">
                {v.kind === 'image' && <img src={assetUrl(v.key, 'thumb')} alt="" width={24} height={24} className="object-contain" />}
                {v.title}
                {v.references.map((r) => (
                  <button key={r} className="underline" onClick={() => navigate(`/references/${r}`)}>
                    №{r}
                  </button>
                ))}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
