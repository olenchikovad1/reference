// Черновик пишется сам (US-0598): работа запись не ждёт, пачка правок — один
// запрос, без связи правка не теряется и уходит сама, соседняя карточка не
// уносит несохранённое прежней.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DraftWriter, readBuffer, type DraftBody, type DraftTarget } from './draftWriter'

const body = (n: number): DraftBody => ({ work: { n }, base_number: 1 })

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

describe('черновик', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('десять правок подряд — одна запись последней, когда рука остановилась', async () => {
    const sent: [DraftTarget, DraftBody][] = []
    const w = new DraftWriter(async (t, b) => void sent.push([t, b]))
    for (let i = 0; i < 10; i += 1) w.change(5, body(i))
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(sent).toEqual([[5, body(9)]])
    expect(w.status).toBe('written')
    expect(readBuffer(5)).toBeNull()
  })

  it('без связи — правка в браузере, повтор сам, потом дошла', async () => {
    let online = false
    const sent: DraftBody[] = []
    const w = new DraftWriter(async (_t, b) => {
      if (!online) throw new Error('нет связи')
      sent.push(b)
    })
    w.change(5, body(1))
    await vi.advanceTimersByTimeAsync(500)
    expect(w.status).toBe('unsent')
    expect(readBuffer(5)?.body).toEqual(body(1))
    online = true
    await vi.advanceTimersByTimeAsync(3100)
    expect(sent).toEqual([body(1)])
    expect(w.status).toBe('written')
  })

  it('ушли на соседнюю карточку — несохранённое прежней уходит сразу', async () => {
    const sent: DraftTarget[] = []
    const w = new DraftWriter(async (t) => void sent.push(t))
    w.change(5, body(1))
    w.change(6, body(2))
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toEqual([5])
    await vi.advanceTimersByTimeAsync(500)
    expect(sent).toEqual([5, 6])
  })

  it('отбросить ждёт запись в пути — удаление ложится после неё, а не до', async () => {
    const log: string[] = []
    let release = () => undefined as void
    const w = new DraftWriter(() => new Promise<void>((r) => (release = () => (log.push('записан'), r()))))
    w.change(5, body(1))
    await vi.advanceTimersByTimeAsync(500)
    w.forget(5)
    const settled = w.settle().then(() => log.push('можно удалять'))
    release()
    await settled
    expect(log).toEqual(['записан', 'можно удалять'])
  })

  it('сохранили во время записи — статус «чисто», а не «записан»', async () => {
    let release = () => undefined as void
    const w = new DraftWriter(() => new Promise<void>((r) => (release = r)))
    w.change(5, body(1))
    await vi.advanceTimersByTimeAsync(500)
    expect(w.status).toBe('writing')
    w.forget(5)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.status).toBe('clean')
    expect(readBuffer(5)).toBeNull()
  })
})
