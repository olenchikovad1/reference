import { Modal, Spinner, TextInput, buttonClass } from '@platform/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { step, STEP_ASKS, STEP_NAMES } from '../shared/api/references'
import { cardKey } from '../shared/cardCache'
import { meaningClass } from './meaning'

/** Причина решения остаётся на экране до подтверждённого ответа сервера. */
export function ReviewDecisionModal({ card, action, onClose, onDone }: {
  card: { id: number; name: string } | null
  action: 'reject' | 'revive'
  onClose: () => void
  onDone: () => void
}) {
  const queries = useQueryClient()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setComment(''); setError(null) }, [card?.id, action])
  async function save() {
    if (!card || !comment.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await step(card.id, action, comment.trim())
      void queries.invalidateQueries({ queryKey: ['references'] })
      void queries.invalidateQueries({ queryKey: cardKey(card.id) })
      void queries.invalidateQueries({ queryKey: ['tasks'] })
      onDone()
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : String(failure)} — повторите; причина сохранена в поле.`)
    } finally { setBusy(false) }
  }
  return <Modal open={card !== null} onClose={() => { if (!busy) onClose() }}
    title={action === 'reject' ? 'Забраковать референс?' : 'Вернуть в работу?'}
    actions={<>
      <button className={buttonClass({ tone: 'neutral', variant: 'outline' })} disabled={busy} onClick={onClose}>отмена</button>
      <button className={meaningClass(action === 'reject' ? 'destroy' : 'agree')} disabled={busy || !comment.trim()} onClick={() => void save()}>
        {busy ? 'выполняем…' : STEP_NAMES[action]}
      </button>
    </>}>
    {card && <div className="flex flex-col gap-3" aria-busy={busy}>
      <p>№{card.id} · {card.name}</p>
      <p className="text-sm text-muted-foreground">{action === 'reject'
        ? 'Работа перейдёт в «Брак» с причиной и историей. Вернуть её в работу сможет главный редактор.'
        : 'Карточка вернётся на витрину черновиком; прежние версии и решения сохранятся.'}</p>
      <TextInput autoFocus aria-label={STEP_ASKS[action]} value={comment} disabled={busy}
        placeholder={`${STEP_ASKS[action]} — обязательно`} onChange={event => setComment(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !busy) void save() }} />
      {busy && <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Сохраняем решение</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
  </Modal>
}
