import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toUnit } from '../../shared/api/colours'
import { frameUrl } from '../../shared/api/products'
import { EMPTY, nudge, remove, select } from '../../shared/composition'
import { sayRemark } from '../../shared/api/references'
import {
  excludeFamilyColour,
  fetchFamily,
  includeFamilyColour,
  tagNames,
  type RefTags,
} from '../../shared/api/references'
import { windowKey } from '../../shared/keys'
import { useDismiss } from '../../shared/useDismiss'
import { useFrameAlpha } from '../../shared/frameAlpha'
import { PICK_TYPE, type Pick as Picked } from '../WorkPicker'
import { type ColourChoice } from '../ColourCompare'
import { PRODUCT } from './constants'
import type { WindowState } from './windowState'
import type { WindowActions } from './windowActions'

// Клавиши, колесо и эффекты рабочего окна (план 114, US-0894): реакции на
// адрес, открытие, выбор, сохранение — и то, что из них считается.

export function useWindowEffects(s: WindowState, a: WindowActions) {
  const {
    catalogue,
    refDropIds,
    ref,
    windowOpen,
    navigate,
    location,
    queries,
    product,
    stateCode,
    setStateCode,
    setSize,
    history,
    composition,
    setComposition,
    commit,
    setDropHint,
    setParams,
    colours,
    colourCode,
    setColourCode,
    setColourModelId,
    setDropId,
    setRestored,
    zoom,
    pan,
    setPan,
    press,
    setBox,
    area,
    stage,
    garmentPicked,
    setGarmentPicked,
    helpOpen,
    setHelpOpen,
    setRefTags,
    tagDraft,
    setTagHints,
    libraryOpen,
    setLibraryOpen,
    setCompareOpen,
    canSave,
    current,
    setCurrent,
    remarks,
    talkOpen,
    setTalkOpen,
    talkRef,
    closeTalk,
    pendingRemark,
    setPendingRemark,
    focusRemark,
    setFocusRemark,
    setViewing,
    setBaseline,
    writer,
    aimed,
    setDraftHeld,
    onServer,
    saving,
    setSaving,
    state,
    visible,
  } = s
  const {
    addFiles,
    zoomTo,
    clampPan,
    versionBody,
    saveCard,
    saveCardAs,
    flip,
    step,
    openCard,
    restoreNew,
    pick,
    close,
  } = a
  // Клавиши окна — одной таблицей (shared/keys.ts). Обработчик ставится один
  // раз и берёт свежее состояние из ref: иначе Ctrl+S сохранял бы то, что было
  // на экране при подписке.
  const keyAction = useRef<(e: KeyboardEvent) => void>(() => undefined)
  keyAction.current = (e: KeyboardEvent) => {
    // Закрытое окно живёт скрытым — клавиши принадлежат витрине.
    if (!windowOpen) return
    const target = e.target as HTMLElement | null
    const typing =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    const a = windowKey(e, typing)
    if (!a) return
    // В окне выбора стрелки ходят по плитке, Delete и цифры — не про принт.
    const inPicker = !!target?.closest?.('[data-picker],[data-own-keys]')
    if (inPicker && !['save', 'save-as', 'escape', 'undo', 'redo'].includes(a.kind)) return
    if (helpOpen) {
      if (a.kind === 'escape' || a.kind === 'help') setHelpOpen(false)
      return
    }
    const selectedId = composition.selectedId
    switch (a.kind) {
      case 'undo':
        e.preventDefault()
        history.undo()
        return
      case 'redo':
        e.preventDefault()
        history.redo()
        return
      case 'save':
      case 'save-as':
        e.preventDefault()
        if (canSave) void (a.kind === 'save' ? saveCard() : saveCardAs())
        return
      case 'card':
        e.preventDefault()
        flip(a.back)
        return
      case 'older':
      case 'newer':
        e.preventDefault()
        step(a.kind)
        return
      case 'help':
        e.preventDefault()
        setHelpOpen((o) => !o)
        return
      case 'remark': {
        const list = remarks.data ?? []
        if (!list.length || !current) return
        e.preventDefault()
        const at = list.findIndex((r) => r.id === focusRemark)
        if (a.what === 'next') {
          setFocusRemark(list[(at + 1) % list.length].id)
          return
        }
        const r = list[at] ?? list[0]
        if (a.what === 'reply') document.getElementById(`remark-reply-${r.id}`)?.focus()
        else if (r.can.includes('fixed'))
          void sayRemark(current.id, r.id, 'fixed').then(() => queries.invalidateQueries({ queryKey: ['remarks', current.id] }))
        return
      }
      case 'escape':
        e.preventDefault()
        // Первый Esc снимает выбор (или уходит из поля), второй закрывает окно.
        if (typing) {
          target?.blur()
          area.current?.focus()
        } else if (libraryOpen) setLibraryOpen(false)
        else if (selectedId || garmentPicked) {
          setComposition((c) => select(c, null))
          setGarmentPicked(false)
        } else if (talkOpen && current) setTalkOpen(false)
        else close()
        return
      case 'view': {
        const s = product?.states[a.index]
        if (!s) return
        e.preventDefault()
        setStateCode(s.code)
        return
      }
      case 'zoom':
        e.preventDefault()
        zoomTo(a.by === 'fit' ? 1 : zoom * (a.by === 'in' ? 1.25 : 1 / 1.25))
        return
      case 'nudge':
        if (!selectedId) return
        e.preventDefault()
        commit((c) => nudge(c, selectedId, a.dxCm, a.dyCm))
        return
      case 'remove':
        if (!selectedId) return
        e.preventDefault()
        commit((c) => remove(c, selectedId))
        return
      case 'next': {
        // Tab ходит по объектам, пока фокус на холсте; с последнего — дальше
        // по окну, как обычно, иначе из холста клавиатурой не выйти.
        if (document.activeElement !== area.current) return
        const ids = visible.elements.map((el) => el.id)
        const at = ids.indexOf(visible.selectedId ?? '')
        const next = at < 0 ? (a.back ? ids.length - 1 : 0) : at + (a.back ? -1 : 1)
        if (next < 0 || next >= ids.length) return
        e.preventDefault()
        setComposition((c) => select(c, ids[next]))
        return
      }
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyAction.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Колесо над изделием — приближение к точке под курсором. Подписка своя, не
  // через React: его обработчик колеса пассивный, и отменить прокрутку из
  // него нельзя. Над панелями колесо листает панели.
  const wheelZoom = useRef<(k: number, around: { x: number; y: number }) => void>(() => undefined)
  wheelZoom.current = (k, around) => zoomTo(zoom * k, around)
  const ready = !!product && !!state
  useEffect(() => {
    const el = area.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const onStage = (e.target as Element).closest('[data-stage]')
      if (!onStage) return
      e.preventDefault()
      const r = onStage.getBoundingClientRect()
      wheelZoom.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, {
        x: e.clientX - r.left - r.width / 2,
        y: e.clientY - r.top - r.height / 2,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ready])

  // Квадрат показа — по месту, которое осталось холсту.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setBox(Math.max(240, Math.floor(Math.min(width, height) - 24)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  // Холст получает фокус при открытии: клавиши работают сразу, без щелчка.
  useEffect(() => {
    if (ready) area.current?.focus({ preventScroll: true })
  }, [ready])

  // Теги приходят вместе с референсом; новый — без них, пока не сохранён.
  useEffect(() => {
    setRefTags(current?.tags ?? null)
  }, [current])

  // Подсказка из уже заведённых своих тегов — по мере ввода.
  useEffect(() => {
    const q = tagDraft.trim()
    if (!q) return setTagHints([])
    const t = setTimeout(() => void tagNames(q).then(setTagHints).catch(() => setTagHints([])), 250)
    return () => clearTimeout(t)
  }, [tagDraft])

  /** Изменить теги: ответ сервиса — новые теги целиком. Не вышло — сказать. */
  function retag(change: (id: number) => Promise<RefTags>) {
    if (!current) return
    void change(current.id)
      .then(setRefTags)
      .catch((e: Error) => setDropHint(`Теги не сохранились: ${e.message} — повторите.`))
  }

  // Выбрали принт — панель изделия уступает ему место.
  useEffect(() => {
    if (composition.selectedId) setGarmentPicked(false)
  }, [composition.selectedId])

  // Цвет изделия виден на холсте: база шейдера следует за кодом цвета, в том
  // числе пришедшим из ячейки дропа или из открытой версии.
  useEffect(() => {
    const c = colours.find((x) => x.code === colourCode)
    if (c) setParams((p) => ({ ...p, base: toUnit(c) }))
  }, [colours, colourCode])

  // Сохранили новый — адрес окна становится адресом референса: ссылку можно
  // отдать, а «назад» по-прежнему ведёт на витрину.
  useEffect(() => {
    if (windowOpen && current && ref !== String(current.id) && (aimed.current === null || aimed.current === current.id))
      navigate(`/references/${current.id}`, { replace: true, state: location.state })
  }, [current?.id])

  // Адрес окна сменился (US-0600): окно живёт всё время, и открыть карточку,
  // начать новую работу или закрыть — это реакция на адрес, а не сборка окна.
  const wasRef = useRef(ref)
  useEffect(() => {
    const was = wasRef.current
    wasRef.current = ref
    if (was === ref) return
    if (ref === undefined) {
      // Закрыли: последняя правка уходит сразу, выбор снят.
      void writer.flush()
      setComposition((c) => select(c, null))
      return
    }
    if (ref === 'new') {
      startNew()
      return
    }
    const id = Number(ref)
    if (id && id !== current?.id && id !== aimed.current) void openCard(id, undefined, was === undefined)
  }, [ref])

  /** Новая работа в уже живущем окне: всё от прежней карточки забыто,
   *  цветомодель и цвет — из адреса (ячейка дропа). */
  function startNew() {
    const q = new URLSearchParams(window.location.search)
    aimed.current = null
    onServer.current = null
    setCurrent(null)
    setViewing(null)
    setBaseline(null)
    setDraftHeld(null)
    setColourModelId(q.get('colour_model') ? Number(q.get('colour_model')) : null)
    setDropId(q.get('drop') ? Number(q.get('drop')) : null)
    setColourCode(q.get('colour') ?? 'WHITE')
    setSize(null)
    history.open(null, EMPTY)
    setRestored(false)
    void restoreNew()
  }

  // Дропы референса — от цветомодели (US-0497): по ним выбор показывает
  // одобренное, а на изделии отмечено взятое не из одобренного.
  const openRemarks = (remarks.data ?? []).filter((r) => r.status === 'open').length
  useEffect(() => {
    setTalkOpen(false)
    setPendingRemark(null)
  }, [current?.id])
  // Недописанное замечание нажатием мимо не теряется: окно ждёт «поставить»
  // или «отмена» (введённое не пропадает — правило экранов).
  useDismiss(talkOpen && !pendingRemark, closeTalk, [talkRef], '[data-talk-toggle]')

  const colourChoices: ColourChoice[] = useMemo(() => {
    const walk = (nodes: typeof catalogue.data): { id: number; colour_code: string; drop_ids: number[] }[] =>
      (nodes ?? []).flatMap((n) => [
        ...n.models.filter((m) => m.code === PRODUCT).flatMap((m) => m.colour_models),
        ...walk(n.children),
      ])
    const models = walk(catalogue.data)
    const drop = refDropIds[0]
    const codes = drop ? models.filter((cm) => cm.drop_ids.includes(drop)).map((cm) => cm.colour_code) : colours.map((c) => c.code)
    return codes.flatMap((code) => {
      const c = colours.find((x) => x.code === code)
      if (!c) return []
      return [{ code, name: c.group, rgb: c.rgb, colourModelId: models.find((cm) => cm.colour_code === code)?.id ?? null }]
    })
  }, [catalogue.data, refDropIds, colours])

  /** Оставить в семье только выбранные цвета (US-0890): остальные исключить.
   *  Карточка одна — не плодим референс на каждый цвет. */
  async function saveColours(picked: ColourChoice[], _canvases: Record<string, Record<string, HTMLCanvasElement | null>>) {
    if (saving || picked.length === 0) return
    if (!current) {
      setDropHint('Сначала сохраните референс — потом состав семьи.')
      return
    }
    setSaving(true)
    try {
      const keep = new Set(picked.map((c) => c.colourModelId).filter((id): id is number => id != null))
      // Основной взгляд семьи убрать нельзя — сервер откажет (решение 0019).
      if (current.colour_model_id != null) keep.add(current.colour_model_id)
      const family = await fetchFamily(current.id)
      for (const c of family) {
        if (keep.has(c.colour_model_id) && !c.in_family) await includeFamilyColour(current.id, c.colour_model_id)
        if (!keep.has(c.colour_model_id) && c.in_family) await excludeFamilyColour(current.id, c.colour_model_id)
      }
      setCompareOpen(false)
      setDropHint(`В семье: ${picked.map((c) => c.name).join(', ')}.`)
    } catch (e) {
      setDropHint(`Семью не обновили: ${e instanceof Error ? e.message : String(e)} — повторите.`)
    } finally {
      setSaving(false)
    }
  }

  const onGarment = useFrameAlpha(product && state ? frameUrl(product.code, state.code) : null)

  function onAreaDown(e: React.PointerEvent<HTMLDivElement>) {
    const t = e.target as Element
    const onStage = !!t.closest('[data-stage]')
    if (onStage) area.current?.focus({ preventScroll: true })
    // Тянем ФОН или средней кнопкой — двигаем вид. Тянем принт — двигаем
    // принт: различает то, за что взялись.
    const background = onStage && t.tagName.toLowerCase() === 'svg'
    if (!(background || (onStage && e.button === 1))) return
    press.current = {
      x: pan.x,
      y: pan.y,
      px: e.clientX,
      py: e.clientY,
      moved: false,
      svg: background ? (t as SVGSVGElement) : null,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onAreaMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current
    if (!p) return
    const dx = e.clientX - p.px
    const dy = e.clientY - p.py
    if (!p.moved && Math.hypot(dx, dy) < 4) return
    p.moved = true
    if (zoom > 1) setPan(clampPan({ x: p.x + dx, y: p.y + dy }, zoom))
  }

  function onAreaUp(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current
    press.current = null
    if (!p || p.moved || !p.svg) return
    // Щелчок без протяжки: по изделию — его панель, мимо — всё закрыто.
    const m = p.svg.getScreenCTM()
    if (!m) return
    const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    setGarmentPicked(onGarment(at.x, at.y))
  }

  /** По иллюстративному ракурсу размещать нельзя: силуэт на нём сокращён,
   *  и перевод сантиметров в пиксели по нему соврёт — принт уйдёт на фабрику
   *  не того размера. Показывать на нём можно, и он показывает. Проверка
   *  одна на все входы: из набора добавлять на бок тоже было можно. */
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const picked = e.dataTransfer.getData(PICK_TYPE)
      if (picked) {
        pick(JSON.parse(picked) as Picked)
        return
      }
      await addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')))
    },
    // Состояние ОБЯЗАНО быть в списке: сторона берётся из него, и с пустым
    // списком брошенное на спину легло бы на перед — замыкание осталось бы от
    // первой отрисовки, а ошибку было бы видно только по чужому кадру.
    [state, stateCode],
  )

  return {
    keyAction,
    wheelZoom,
    ready,
    retag,
    wasRef,
    startNew,
    openRemarks,
    colourChoices,
    saveColours,
    onGarment,
    onAreaDown,
    onAreaMove,
    onAreaUp,
    onDrop,
  }
}
