import { TextInput, buttonClass } from '@platform/ui'
import { useEffect, useRef, useState } from 'react'

import { addRemark, sayRemark, SAY_NAMES, addVoiceRemark, fetchRemarkAudio, isHearing, setRemarkText, type Remark, type ReferenceFull as FullCard } from '../../shared/api/references'
import { meaningClass } from '../../candidates/meaning'

import { Section } from './controls'

export type PendingRemark = { x: number | null; y: number | null; element_id: string | null; element_name: string | null }

/** Замечание просто к референсу (план 095): без точки и без слоя. */
export const FREE_REMARK: PendingRemark = { x: null, y: null, element_id: null, element_name: null }

/** Замечания (US-0511): на слое или месте изделия, на версии, с веткой.
 *  Открытые первыми; закрытые не пропадают — остаются в истории. */
export function RemarksSection(props: {
  card: FullCard
  side: string
  sideName: (code: string) => string
  remarks: Remark[]
  focus: number | null
  onFocus: (id: number | null) => void
  placing: boolean
  onPlacing: (on: boolean) => void
  pending: PendingRemark | null
  onPending: (p: PendingRemark | null) => void
  onChanged: () => void
}) {
  const { card, remarks } = props
  const [text, setText] = useState('')
  const [reply, setReply] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const open = remarks.filter((r) => r.status === 'open').length
  const last = card.number
  const done = (p: Promise<unknown>) =>
    void p
      .then(() => {
        setError(null)
        props.onChanged()
      })
      .catch((e: Error) => setError(e.message))
  const put = () => {
    if (!props.pending || !text.trim()) return
    const p = props.pending
    done(
      addRemark(card.id, { side: p.x === null ? null : props.side, x: p.x, y: p.y, text, element_id: p.element_id }).then(() => {
        setText('')
        props.onPending(null)
      }),
    )
  }
  return (
    <Section title={`Замечания · ${open} открыто`}>
      <div className="flex flex-col gap-1 text-xs">
        {(card.can ?? []).includes('remark') && !props.pending && (
          <button className={meaningClass('act', true)} onClick={() => props.onPending(FREE_REMARK)}>
            + замечание
          </button>
        )}
        {props.pending && (
          <div className="flex flex-col gap-1 rounded border border-line p-1">
            {props.pending.x !== null && (
              <span className="text-muted-foreground">
                {props.pending.element_name ? `на слое ${props.pending.element_name}` : 'на месте изделия'}
              </span>
            )}
            <TextInput
              aria-label="текст замечания"
              autoFocus
              value={text}
              placeholder="что поправить: «ракету на спине — меньше»"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') put()
                if (e.key === 'Escape') props.onPending(null)
              }}
            />
            <VoiceButton
              onRecorded={(audio) => {
                const p = props.pending!
                done(
                  addVoiceRemark(card.id, { side: p.x === null ? null : props.side, x: p.x, y: p.y, element_id: p.element_id }, audio).then(() => {
                    setText('')
                    props.onPending(null)
                  }),
                )
              }}
              onError={setError}
            />
            <div className="flex gap-1">
              <button className={meaningClass('act', true)} disabled={!text.trim()} onClick={put}>
                поставить
              </button>
              <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => props.onPending(null)}>
                отмена
              </button>
            </div>
          </div>
        )}
        {error && <span className="text-destructive">{error}</span>}
        {remarks.length === 0 && <span className="text-muted-foreground">замечаний нет</span>}
        {remarks.map((r, i) => (
          <div
            key={r.id}
            onClick={() => props.onFocus(r.id)}
            className={`rounded border px-1.5 py-1 ${props.focus === r.id ? 'border-primary' : 'border-line'} ${r.status === 'accepted' ? 'opacity-60' : ''}`}
          >
            <RemarkText card={card} remark={r} n={i + 1} onChanged={props.onChanged} onError={setError} />
            {r.audio && <RemarkAudio referenceId={card.id} remark={r} />}
            <div className="text-muted-foreground">
              {r.side ? `${r.element_name ? `слой ${r.element_name}` : 'место изделия'} · ${props.sideName(r.side).toLowerCase()} · ` : ''} {r.author_name ?? 'без входа'}
              {r.number < last ? ` · из версии ${r.number}` : ''}
              {r.status === 'fixed' && r.fixed_in ? ` · исправлено в ${r.fixed_in}` : ''}
              {r.status === 'accepted' ? ' · принято' : ''}
            </div>
            {r.messages.map((m, j) => (
              <div key={j} className="pl-2">
                {m.author_name ?? 'без входа'}: {SAY_NAMES[m.kind]}
                {m.text ? ` — ${m.text}` : ''}
              </div>
            ))}
            <div className="mt-0.5 flex flex-wrap gap-1">
              {r.can.includes('reply') && (
                <div className="w-full">
                  <TextInput
                    id={`remark-reply-${r.id}`}
                    aria-label={`ответ на замечание ${i + 1}`}
                    value={reply[r.id] ?? ''}
                    placeholder="ответить (R)"
                    onChange={(e) => setReply((x) => ({ ...x, [r.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter' && (reply[r.id] ?? '').trim())
                        done(sayRemark(card.id, r.id, 'reply', reply[r.id]).then(() => setReply((x) => ({ ...x, [r.id]: '' }))))
                    }}
                  />
                </div>
              )}
              {(['fixed', 'accepted', 'rejected'] as const)
                .filter((k) => r.can.includes(k))
                .map((k) => (
                  <button
                    key={k}
                    className={meaningClass(k === 'rejected' ? 'object' : 'agree', true)}
                    onClick={() =>
                      done(
                        sayRemark(card.id, r.id, k, k === 'rejected' ? reply[r.id] : undefined).then(() =>
                          setReply((x) => ({ ...x, [r.id]: '' })),
                        ),
                      )
                    }
                  >
                    {SAY_NAMES[k]}
                    {k === 'fixed' ? ' (F)' : ''}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

/** Запись голоса: удерживать кнопку или клавишу V — идёт запись и секунды;
 *  отпустили — запись уходит. Короче полсекунды — нажали случайно. */
export function VoiceButton(props: { onRecorded: (audio: Blob) => void; onError: (e: string) => void }) {
  const [seconds, setSeconds] = useState<number | null>(null)
  const rec = useRef<{ r: MediaRecorder; chunks: Blob[]; at: number; timer: number } | null>(null)
  const start = async () => {
    if (rec.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const r = new MediaRecorder(stream)
      const chunks: Blob[] = []
      r.ondataavailable = (e) => chunks.push(e.data)
      const at = performance.now()
      const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - at) / 1000)), 250)
      rec.current = { r, chunks, at, timer }
      setSeconds(0)
      r.start()
    } catch (e) {
      props.onError(`микрофон недоступен: ${(e as Error).message}`)
    }
  }
  const stop = () => {
    const cur = rec.current
    if (!cur) return
    rec.current = null
    window.clearInterval(cur.timer)
    setSeconds(null)
    cur.r.onstop = () => {
      cur.r.stream.getTracks().forEach((t) => t.stop())
      if (performance.now() - cur.at < 500) return
      props.onRecorded(new Blob(cur.chunks, { type: cur.r.mimeType || 'audio/webm' }))
    }
    cur.r.stop()
  }
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'KeyV' || e.repeat || typing(e)) return
      e.preventDefault()
      e.stopPropagation()
      void start()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyV') stop()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  })
  return (
    <button
      className={buttonClass({ tone: seconds === null ? 'neutral' : 'accent', variant: seconds === null ? 'outline' : 'soft', small: true })}
      onPointerDown={() => void start()}
      onPointerUp={stop}
      onPointerLeave={stop}
    >
      {seconds === null ? '● удерживайте — говорите (V)' : `● идёт запись · ${seconds} с`}
    </button>
  )
}

/** Текст замечания: у голосового — «расшифровывается», отказ с причиной,
 *  «как услышано», если поправлено; автор правит на месте. */
export function RemarkText(props: { card: FullCard; remark: Remark; n: number; onChanged: () => void; onError: (e: string) => void }) {
  const r = props.remark
  const [editing, setEditing] = useState<string | null>(null)
  const save = () => {
    if (editing === null || !editing.trim()) return
    void setRemarkText(props.card.id, r.id, editing)
      .then(() => {
        setEditing(null)
        props.onChanged()
      })
      .catch((e: Error) => props.onError(e.message))
  }
  if (editing !== null)
    return (
      <TextInput
        aria-label={`текст замечания ${props.n}`}
        autoFocus
        value={editing}
        onChange={(e) => setEditing(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setEditing(null)
        }}
        onBlur={save}
      />
    )
  return (
    <div>
      <div className="font-semibold">
        {props.n}.{' '}
        {r.text ||
          (isHearing(r) ? (
            <span className="font-normal text-muted-foreground">расшифровывается…</span>
          ) : (
            <span className="font-normal text-muted-foreground">без текста</span>
          ))}
        {r.can_edit && r.text && (
          <button className="ml-1 font-normal text-muted-foreground underline" onClick={() => setEditing(r.text)}>
            править
          </button>
        )}
      </div>
      {r.voice_status === 'failed' && (
        <div className="text-destructive">расшифровать не удалось: {r.voice_error} — запись сохранена, текст можно вписать</div>
      )}
      {r.voice_status === 'failed' && r.can_edit && !r.text && (
        <button className="text-muted-foreground underline" onClick={() => setEditing('')}>
          вписать текст
        </button>
      )}
      {r.heard && r.heard !== r.text && <div className="text-muted-foreground">услышано: {r.heard}</div>}
    </div>
  )
}

/** Плеер записи. Запись приходит через fetch и живёт, пока виден плеер. */
export function RemarkAudio(props: { referenceId: number; remark: Remark }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let made: string | null = null
    let alive = true
    fetchRemarkAudio(props.referenceId, props.remark.id)
      .then((b) => {
        if (!alive) return
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [props.referenceId, props.remark.id])
  if (error) return <div className="text-destructive">{error}</div>
  return url ? <audio controls src={url} className="h-7 w-full" aria-label={`запись замечания`} /> : null
}
