import { Hint, Icon, TextInput } from '@platform/ui'
import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { step as reviewStep, STATUS_NAMES, STEP_ASKS, moveToDrop, fetchAgendaOf, propose as proposeForDiscussion, unpropose as unproposeDiscussion, STEP_NAMES, type ReferenceFull as FullCard, type Step } from '../../shared/api/references'
import { openReference } from '../../shared/api/references'
import { CODE } from '../../app/shell'
import { useCan } from '../../shared/api/platform'
import { decisions, moveTargets, type Rights } from '../../shared/decisions'
import { ThumbsUp } from '../../candidates/ThumbsUp'
import { useDismiss } from '../../shared/useDismiss'
import { meaningClass, type Meaning } from '../../candidates/meaning'
import { fetchDrops } from '../../shared/api/drops'


/** Смысл шага — цвет его кнопки (US-0690): согласие, возражение, брак. */
export const STEP_MEANING: Record<Step, Meaning> = {
  submit: 'agree',
  recall: 'quiet',
  return: 'object',
  approve: 'agree',
  unapprove: 'object',
  'approve-final': 'agree',
  reject: 'destroy',
  revive: 'agree',
}

/** Что случится по нажатию — подсказка при наведении (правило платформы:
 *  у кнопки при наведении видно, что она сделает). */
export const STEP_HINTS: Record<Step, string> = {
  submit: 'Отправить на согласование: у редакторов загорится колокол',
  recall: 'Забрать с согласования обратно в черновик, пока никто не решил',
  return: 'Вернуть дизайнеру на доработку — спросит, что поправить; исполнителю придёт уведомление',
  approve: 'Согласовать: статус «согласован», главный сможет принять окончательно',
  unapprove: 'Вернуть на согласование — спросит причину',
  'approve-final': 'Принять окончательно: дальше — только техпакет на фабрику',
  reject: 'Забраковать референс — спросит причину; исполнителю придёт уведомление, править его будет нельзя',
  revive: 'Вернуть забракованный в работу черновиком — спросит причину',
}

/** Полоса решений внизу окна (план 096): 👍 «нравится», ✕ «на доработку»,
 *  💬 «обсуждение» и ⋯ «статус» — остальные переходы и перенос в дроп.
 *  Только то, что мне доступно сейчас: по состоянию, роли в согласовании и
 *  праву платформы (без функции «Окончательное принятие» кнопки нет — раньше
 *  она была и отвечала Not Found). Где нужна причина — поле тут же. */
export function DecisionBar(props: {
  card: FullCard
  openRemarks: number
  talkOpen: boolean
  onTalk: (on: boolean) => void
  onRemark: () => void
  onChanged: (card: FullCard) => void
  /** Дропы, где референс уже лежит: переносить в них нечего. */
  currentDrops: number[]
}) {
  const { card } = props
  const rights: Rights = {
    writeReferences: useCan(CODE, 'references', 'write'),
    writeReview: useCan(CODE, 'review', 'write'),
    viewReview: useCan(CODE, 'review', 'view'),
    approveFinal: useCan(CODE, 'review', 'approve-final'),
  }
  const drops = useQuery({ queryKey: ['drops'], queryFn: fetchDrops, staleTime: 60_000 })
  const [asking, setAsking] = useState<Step | 'propose' | null>(null)
  const [comment, setComment] = useState('')
  const queries = useQueryClient()
  const agenda = useQuery({ queryKey: ['agenda', card.id], queryFn: () => fetchAgendaOf(card.id) })
  const onAgenda = (agenda.data ?? []).length > 0
  const agendaChanged = () => {
    void queries.invalidateQueries({ queryKey: ['agenda', card.id] })
    void queries.invalidateQueries({ queryKey: ['references'] })
    void queries.invalidateQueries({ queryKey: ['agenda-page'] })
  }
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => {
    setMenu(false)
    setMoving(false)
  }, [])
  useDismiss(menu, closeMenu, [menuRef], '[data-status-toggle]')
  const [moving, setMoving] = useState(false)
  const status = card.status ?? 'draft'
  // Кнопка — только если её разрешают и роль, и право платформы.
  const { like, liked, canReturn, menu: rest, canRemark, canPropose, canMove } = decisions(status, card.can ?? [], rights)
  const said = (e: Error) =>
    /not found/i.test(e.message)
      ? 'на это нет права в платформе — его выдают в «Доступах» платформы (набор «Суперредактор» или функция раздела «Согласование»)'
      : e.message
  const act = (what: Step | 'propose') => {
    setBusy(true)
    if (what === 'propose') {
      void proposeForDiscussion(card.id, comment)
        .then(() => {
          setComment('')
          setAsking(null)
          setError(null)
          agendaChanged()
        })
        .catch((e: Error) => setError(said(e)))
        .finally(() => setBusy(false))
      return
    }
    void reviewStep(card.id, what, comment)
      .then(() => openReference(card.id))
      .then((fresh) => {
        setComment('')
        setAsking(null)
        setError(null)
        props.onChanged(fresh)
      })
      .catch((e: Error) => setError(said(e)))
      .finally(() => setBusy(false))
  }
  const press = (what: Step) => {
    setMenu(false)
    if (STEP_ASKS[what]) {
      setAsking(what)
      setComment('')
    } else act(what)
  }
  const moveTo = (dropId: number) => {
    setBusy(true)
    void moveToDrop(card.id, dropId)
      .then(() => openReference(card.id))
      .then((fresh) => {
        setMoving(false)
        setMenu(false)
        setError(null)
        props.onChanged(fresh)
      })
      .catch((e: Error) => setError(said(e)))
      .finally(() => setBusy(false))
  }
  const big = (meaning: Meaning) => `${meaningClass(meaning, false, true)} flex items-center gap-1.5`
  return (
    <div
      className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col items-center gap-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {error && <div className="pf-card border border-line bg-background px-2 py-1 text-xs text-destructive">{error}</div>}
      {asking && (
        <div className="pf-card flex items-center gap-1 border border-line bg-background p-1">
          <TextInput
            aria-label={asking === 'propose' ? 'что обсудить' : STEP_ASKS[asking]}
            autoFocus
            value={comment}
            placeholder={asking === 'propose' ? 'что обсудить на встрече' : `${STEP_ASKS[asking]} — без этого «${STEP_NAMES[asking]}» нельзя`}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && comment.trim()) act(asking)
              if (e.key === 'Escape') setAsking(null)
            }}
          />
          <button className={meaningClass(asking === 'propose' ? 'act' : STEP_MEANING[asking], false, true)} disabled={!comment.trim() || busy} onClick={() => act(asking)}>
            {asking === 'propose' ? 'выдвинуть' : STEP_NAMES[asking]}
          </button>
          <button className={meaningClass('quiet', false, true)} onClick={() => setAsking(null)}>
            отмена
          </button>
        </div>
      )}
      <div className="pf-card relative flex items-center gap-2 border border-line bg-background/95 p-2 shadow" aria-label="решения по референсу">
        <span className="px-1 text-xs text-muted-foreground">{STATUS_NAMES[status]}</span>
        {onAgenda && (
          <Hint text="Что предложили обсудить — открыть обсуждение">
            <button
              data-talk-toggle
              className="whitespace-nowrap rounded bg-warning/15 px-1.5 py-0.5 text-xs font-semibold text-warning hover:bg-warning/25"
              onClick={() => (setMenu(false), props.onTalk(true))}
            >
              на обсуждении
            </button>
          </Hint>
        )}
        {(like || liked) && (
          <Hint text={like ? STEP_HINTS[like] : 'Уже согласован'}>
            <button
              className={big('agree')}
              // Без хода — aria-disabled, а не disabled: у отключённой кнопки
              // нет наведения, и подсказка «уже согласован» не всплыла бы.
              disabled={busy}
              aria-disabled={!like}
              aria-pressed={liked}
              onClick={() => like && press(like)}
            >
              <ThumbsUp /> {like === 'approve-final' ? 'окончательно' : liked ? 'нравится ✓' : 'нравится'}
            </button>
          </Hint>
        )}
        {canReturn && (
          <Hint text={STEP_HINTS.return}>
            <button className={big('object')} disabled={busy} onClick={() => press('return')}>
              <Icon name="x" size={20} /> на доработку
            </button>
          </Hint>
        )}
        <Hint text="Открыть замечания — написать новое текстом или голосом — и путь по версиям">
          <button className={big('quiet')} data-talk-toggle aria-pressed={props.talkOpen} onClick={() => (setMenu(false), props.onTalk(!props.talkOpen))}>
            <Icon name="message-circle" size={20} /> обсуждение{props.openRemarks ? ` · ${props.openRemarks}` : ''}
          </button>
        </Hint>
        <Hint text="Другие переходы статуса, замечание и перенос в другой дроп">
          <button className={big('quiet')} data-status-toggle aria-expanded={menu} onClick={() => (props.onTalk(false), setMenu((v) => !v))}>
            <Icon name="list" size={20} /> статус
          </button>
        </Hint>
        {menu && (
          <div ref={menuRef} className="pf-card absolute bottom-full right-0 mb-2 flex w-64 flex-col gap-1 border border-line bg-background p-2 text-sm shadow-lg">
            {rest.map((what) => (
              <Hint key={what} text={STEP_HINTS[what]} side="left">
                <button className={meaningClass(STEP_MEANING[what], true, true)} disabled={busy} onClick={() => press(what)}>
                  {STEP_NAMES[what]}
                </button>
              </Hint>
            ))}
            {canRemark && (
              <Hint text="Написать замечание к референсу — текстом или голосом; исполнитель увидит его в обсуждении" side="left">
                <button className={meaningClass('act', true, true)} onClick={() => (setMenu(false), props.onRemark())}>
                  замечание
                </button>
              </Hint>
            )}
            {canPropose && (
            <Hint text={onAgenda ? 'Добавить ещё повод к обсуждению этого референса на встрече' : 'Вынести на встречу: попадёт в повестку с поводом; статус не меняется'} side="left">
              <button className={meaningClass('act', true, true)} onClick={() => (setMenu(false), setAsking('propose'), setComment(''))}>
                {onAgenda ? 'ещё повод обсудить' : 'выдвинуть на обсуждение'}
              </button>
            </Hint>
            )}
            {canPropose && onAgenda && (
              <Hint text="Убрать из повестки — обсуждать не нужно" side="left">
                <button
                  className={meaningClass('withdraw', true, true)}
                  onClick={() =>
                    void unproposeDiscussion(card.id)
                      .then(() => (setMenu(false), agendaChanged()))
                      .catch((e: Error) => setError(said(e)))
                  }
                >
                  снять с обсуждения
                </button>
              </Hint>
            )}
            {canMove && (!moving ? (
              <Hint text="Перевести на цветомодель той же модели в ассортименте другого дропа" side="left">
                <button className={meaningClass('quiet', true, true)} onClick={() => setMoving(true)}>
                  перенести в дроп…
                </button>
              </Hint>
            ) : (
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {moveTargets(drops.data ?? [], props.currentDrops).map((d) => (
                    <button key={d.id} className={meaningClass('act', true, true)} disabled={busy} onClick={() => moveTo(d.id)}>
                      {d.name}
                    </button>
                ))}
              </div>
            ))}
            {rest.length === 0 && !canRemark && !canPropose && !canMove && (
              <span className="text-xs text-muted-foreground">других переходов у вас сейчас нет</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
