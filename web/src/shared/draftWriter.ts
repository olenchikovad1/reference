// Черновик между версиями (US-0598): каждая правка уходит на сервер сама,
// когда рука остановилась. Работа запись не ждёт никогда.
//
// Пока запрос в пути или связи нет, правка лежит ещё и в браузере: закрыли
// вкладку без сети — при следующем открытии браузерная копия новее серверной,
// и берётся она. Серверная — чтобы правка была на другом компьютере.
//
// Вопроса «сохранить?» при уходе больше нет: уйти — значит оставить черновик.

import { useEffect, useRef, useState } from 'react'

import { putDraft } from './api/references'

export interface DraftBody {
  readonly work: unknown
  /** Версия, поверх которой правки; нет — у работы версий нет. */
  readonly base_number: number | null
}

/** clean — писать нечего; writing — в пути; written — на сервере; unsent —
 *  не дошло (нет связи), повторяется само. */
export type DraftStatus = 'clean' | 'writing' | 'written' | 'unsent'

/** null — новая, ещё не сохранённая работа. */
export type DraftTarget = number | null

type Send = (target: DraftTarget, body: DraftBody, keepalive: boolean) => Promise<void>

const bufferKey = (target: DraftTarget) => `reference.draft.${target ?? 'new'}`

/** Браузерная копия черновика с моментом правки. */
export interface Buffered {
  readonly body: DraftBody
  readonly at: number
}

export function readBuffer(target: DraftTarget): Buffered | null {
  try {
    const raw = localStorage.getItem(bufferKey(target))
    return raw ? (JSON.parse(raw) as Buffered) : null
  } catch {
    return null
  }
}

function writeBuffer(target: DraftTarget, body: DraftBody): void {
  try {
    localStorage.setItem(bufferKey(target), JSON.stringify({ body, at: Date.now() }))
  } catch {
    // Переполненное или запрещённое хранилище — не повод ронять работу:
    // серверная запись идёт своим путём.
  }
}

/** Убрать браузерную копию — но только ту, что дошла: за время запроса могла
 *  лечь новая правка, и её стирать нельзя. */
function clearBuffer(target: DraftTarget, sent?: DraftBody): void {
  try {
    const now = readBuffer(target)
    if (sent === undefined || (now && JSON.stringify(now.body) === JSON.stringify(sent))) {
      localStorage.removeItem(bufferKey(target))
    }
  } catch {
    // см. writeBuffer
  }
}

export class DraftWriter {
  private pending: { target: DraftTarget; body: DraftBody } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight: Promise<void> | null = null
  // Поколение: «Сохранить» или «отбросить» во время запроса не должны
  // увидеть, как ответ запоздавшей записи вернул статус «записан».
  private generation = 0
  status: DraftStatus = 'clean'

  constructor(
    private readonly send: Send,
    private readonly onStatus: (s: DraftStatus) => void = () => undefined,
    private readonly delayMs = 400,
    private readonly retryMs = 3000,
  ) {}

  /** Новая правка: в браузер сразу, на сервер — когда рука остановится.
   *  Правка другой карточки сначала отправляет несохранённое прежней. */
  change(target: DraftTarget, body: DraftBody): void {
    if (this.pending && this.pending.target !== target) void this.flush()
    this.pending = { target, body }
    writeBuffer(target, body)
    this.schedule(this.delayMs)
  }

  /** Отправить отложенное сейчас — при уходе с карточки и перед «Сохранить». */
  async flush(keepalive = false): Promise<void> {
    this.cancelTimer()
    if (this.inflight) await this.inflight
    const p = this.pending
    if (!p) return
    this.pending = null
    const gen = this.generation
    this.set('writing')
    this.inflight = this.send(p.target, p.body, keepalive).then(
      () => {
        clearBuffer(p.target, p.body)
        if (gen === this.generation && !this.pending) this.set('written')
      },
      () => {
        if (gen !== this.generation) return
        // Не дошло — правка остаётся отложенной, если новой нет, и повтор
        // идёт сам: человек делает свою работу, а не жмёт «ещё раз».
        if (!this.pending) this.pending = p
        this.set('unsent')
        this.schedule(this.retryMs)
      },
    )
    try {
      await this.inflight
    } finally {
      this.inflight = null
    }
  }

  /** Дождаться записи, которая уже в пути, — перед «отбросить»: иначе она
   *  легла бы на сервер после удаления и вернула черновик. */
  async settle(): Promise<void> {
    if (this.inflight) await this.inflight
  }

  /** Правки стали версией или отброшены: писать нечего, копия не нужна. */
  forget(target: DraftTarget): void {
    this.generation += 1
    this.cancelTimer()
    if (this.pending?.target === target) this.pending = null
    clearBuffer(target)
    this.set('clean')
  }

  private schedule(ms: number): void {
    this.cancelTimer()
    this.timer = setTimeout(() => void this.flush(), ms)
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private set(s: DraftStatus): void {
    this.status = s
    this.onStatus(s)
  }
}

/** Писатель черновика на всё окно: один на время жизни окна, отложенное
 *  уходит при закрытии страницы и при возврате связи. */
export function useDraftWriter(): { writer: DraftWriter; status: DraftStatus } {
  const [status, setStatus] = useState<DraftStatus>('clean')
  const ref = useRef<DraftWriter | null>(null)
  if (ref.current === null) ref.current = new DraftWriter(putDraft, setStatus)
  const writer = ref.current
  useEffect(() => {
    const online = () => void writer.flush()
    const leave = () => void writer.flush(true)
    window.addEventListener('online', online)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('pagehide', leave)
      // Окно закрыли — последняя правка уходит запросом, переживающим уход.
      void writer.flush(true)
    }
  }, [writer])
  return { writer, status }
}
