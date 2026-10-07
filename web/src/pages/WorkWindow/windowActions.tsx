import { useEffect } from 'react'
import { printUrl, type PrintItem } from '../../shared/api/prints'
import { EMPTY, add, remove, select, restyle, type ImageElement, type TextElement } from '../../shared/composition'
import { DEFAULT_FONT } from '../../shared/fonts'
import { measureAspect } from '../../shared/text'
import type { Match } from '../../shared/api/assets'
import { assetUrl, defectText, digestOf, recogniseAssets, uploadAssets, uploadCanvas, UploadRefused } from '../../shared/api/assets'
import { dropDraft as discardDraft, newDraft, openReference, openVersion, saveReference, saveVersion, type ReferenceFull, type Saved, type VersionBody } from '../../shared/api/references'
import { readDropped } from '../../shared/dropped'
import { moveToSide, newElementId, onSide, sidesUsed, upgrade } from '../../shared/sides'
import { fetchTexts } from '../../shared/api/texts'
import { type Pick as Picked } from '../WorkPicker'
import { readBuffer, type DraftBody } from '../../shared/draftWriter'
import { cardKey, cardNow, ORDER_KEY, prefetchCard, rememberDraft } from '../../shared/cardCache'
import { onImageLoad, warmImage } from '../../shared/imageCache'
import { neighbour, workKey } from '../../shared/versions'
import { describe as describeSheet, render as renderSheet } from '../../shared/sheet'
import { type SavedWork, newer, shrink, probeImage } from './work'
import { MIN_ZOOM, PRODUCT, RECOGNITION_PX_PER_CM, SIDE_NAMES, type SideFinding, VIEW_SIZE } from './constants'
import type { WindowState } from './windowState'

// Действия рабочего окна (план 114, US-0894): сохранить, открыть версию или
// карточку, черновик, печатный лист, положить на изделие, закрыть.

export function useWindowActions(s: WindowState) {
  const {
    refDropIds,
    navigate,
    location,
    queries,
    product,
    stateCode,
    setStateCode,
    size,
    setSize,
    history,
    composition,
    setComposition,
    commit,
    setDropHint,
    setRenderScale,
    colours,
    colourFromDrop,
    colourCode,
    setColourCode,
    colourModelId,
    setColourModelId,
    fontsReady,
    images,
    setImagesVersion,
    setRestored,
    zoom,
    setZoom,
    setPan,
    box,
    setSeen,
    setSeenCards,
    setTagsOf,
    current,
    setCurrent,
    viewing,
    setViewing,
    setBaseline,
    writer,
    aimed,
    setColdView,
    draftHeld,
    setDraftHeld,
    onServer,
    saving,
    setSaving,
    dismissed,
    viewCanvas,
    thumbCanvases,
    measurer,
    state,
    grid,
    sized,
    visible,
    thumbWork,
    setThumbWork,
    clips,
    selected,
    nowKey,
    dirty,
    dirtyNow,
    findings,
  } = s
  const keyOf = (f: SideFinding) => `${f.side}:${f.rule}:${f.elementId ?? '-'}`
  const open = findings.filter((f) => !dismissed.has(keyOf(f)))

  // Когда шрифты доехали, пропорции надписей пересчитываются: измеренные по
  // запасному шрифту они неверны, и надпись оказалась бы не той ширины.
  useEffect(() => {
    if (!fontsReady) return
    setComposition((c) =>
      c.elements.reduce(
        (acc, el) => (el.kind === 'text' ? restyle(acc, el.id, { textAspect: aspectOf(el) }) : acc),
        c,
      ),
    )
  }, [fontsReady])

  /** Пропорция надписи меряется по отрисованному: вычислить её из текста нельзя. */
  function aspectOf(t: Pick<TextElement, 'text' | 'fontFamily' | 'weight' | 'rgb'>): number {
    if (!measurer.current) {
      measurer.current = document.createElement('canvas').getContext('2d')
    }
    return measurer.current ? measureAspect(measurer.current, t) : 4
  }

  /** Принт из набора — одним нажатием. Путь через проводник убивает привычку
   *  на второй день, а эталонами пользуются постоянно. */
  async function addFromSet(item: PrintItem) {
    // Печатный принт из набора — ФАЙЛОМ, тем же путём, что брошенный: в
    // хранилище, с вектором, узнаванием и тегами. Эталон стенда — сетка,
    // буквы, линии — остаётся пробой: это не принт, и в библиотеке с тегами
    // ему не место.
    if (item.kind !== 'probe') {
      const blob = await (await fetch(printUrl(item.path))).blob()
      const file = new File([blob], item.name, { type: blob.type || 'image/png' })
      await addFiles([file], item.width_cm ?? 18)
      return
    }
    if (refusedHere()) return
    const img = new Image()
    img.onload = () => {
      cacheImage(img.src)
      commit((c) =>
        add(c, {
          id: newElementId(),
          kind: 'image',
          name: item.name,
          src: img.src,
          aspect: img.naturalWidth / img.naturalHeight,
          // Эталон считается вырезанным: он нарисован кодом и прозрачность у
          // него настоящая, кроме того, который её нарочно не имеет.
          hasAlpha: item.name !== 'fon-ne-vyrezan.png',
          placement: {
            side: stateCode,
            anchor: 'neck',
            dxCm: 0,
            dyCm: 12,
            // У эталона размер известен и обязан соблюдаться: сетка в 20 см
            // проверяет калибровку только если ложится двадцатью сантиметрами.
            widthCm: item.width_cm ?? 18,
            rotation: 0,
          },
        }),
      )
    }
    img.src = printUrl(item.path)
  }

  /** Кладёт картинку в общий кэш и будит тех, кто её ждёт. */
  function cacheImage(src: string) {
    warmImage(src)
  }
  useEffect(() => onImageLoad(() => setImagesVersion((v) => v + 1)), [])

  /** Приблизить показ.
   *
   * Разрешение отрисовки растёт ВМЕСТЕ с приближением: иначе увеличенное
   * изображение — это увеличенные пиксели, по которым о печати судить нельзя,
   * а именно ради этого его и приближают.
   */
  function zoomTo(next: number, around?: { x: number; y: number }) {
    // Отдалить можно до половины от «вписать в окно» (владелец 29.09: хочется
    // кофту с полями вокруг), дальше изделие только мельчало бы.
    const z = Math.min(6, Math.max(MIN_ZOOM, Number(next.toFixed(2))))
    setZoom(z)
    setRenderScale(Math.min(3, Math.ceil(z)))
    if (z <= 1) {
      setPan({ x: 0, y: 0 })
      return
    }
    // Приближение к точке под курсором, а не к центру: иначе разглядываемая
    // деталь уезжает из окна ровно в тот момент, когда её увеличили.
    setPan((p) => {
      if (!around) return clampPan(p, z)
      const k = z / zoom
      return clampPan({ x: around.x - (around.x - p.x) * k, y: around.y - (around.y - p.y) * k }, z)
    })
  }

  /** Не даёт увести изделие за край окна: уехавшую часть вернуть нечем. */
  function clampPan(p: { x: number; y: number }, z: number) {
    const limit = (box * (z - 1)) / 2
    return {
      x: Math.min(limit, Math.max(-limit, p.x)),
      y: Math.min(limit, Math.max(-limit, p.y)),
    }
  }

  /** Сохранить собранный принт и узнать, не собирали ли такой раньше.
   *
   * Лист кладётся в хранилище как обычная картинка: по нему считается вектор
   * «такой принт уже был», а вторая копия рядом разошлась бы с первой.
   */
  async function versionBody(): Promise<VersionBody | null> {
    // Сохраняется СТОРОНА, а не изделие целиком: перед и спина печатаются
    // разными прогонами, и «такой принт уже был» — вопрос про сторону.
    if (visible.elements.length === 0) return null
    // Лист для узнавания — мелкий: модель всё равно сжимает картинку до 224
    // точек, а лист в 120 точек на сантиметр (3600 на 30 см) рисовался,
    // кодировался и считался вектором секундами. Печатный лист на фабрику
    // выгружается отдельно и в полном разрешении.
    const canvas = renderSheet(visible, images.current, RECOGNITION_PX_PER_CM, clips)
    const sheet = await uploadCanvas(canvas, `${PRODUCT}-${stateCode}-list.png`)
    return {
      name: `${PRODUCT} · ${SIDE_NAMES[stateCode] ?? stateCode} · ${colourCode}${size ? ' · ' + size : ''}`,
      sheet_digest: sheet,
      image_digests: visible.elements
        .filter((el) => el.kind === 'image')
        .map((el) => digestOf(el.src))
        .filter(Boolean),
      texts: visible.elements
        .filter((el) => el.kind === 'text')
        .map((el) => (el.kind === 'text' ? el.text : '')),
      // Работа целиком — все стороны, сантиметры базы, исключения размеров,
      // цвет. Лист и надписи выше — для узнавания; открывается версия
      // вот этим.
      work: { version: 2, stateCode, colourCode, size, composition },
    }
  }

  /** «Сохранить» (Ctrl+S): новая версия открытого референса, а если его ещё
   *  нет — новый референс. Открытая старая версия ложится поверх последней,
   *  а не на своё место. false — не сохранилось, и сказано почему. */
  async function saveCard(): Promise<boolean> {
    const saved = await keep(async (body) =>
      current ? saveVersion(current.id, body) : saveReference({ ...body, colour_model_id: colourModelId }),
    )
    return saved !== null
  }

  /**
   * Версия сама перед переходом (US-0599): работа уходит наружу — на фабрику,
   * в копии, — и уходить должна версия, а не черновик. Ничего не меняли —
   * версия та, что на экране, новой нет. Новая работа карточки сама не
   * заводит: null. 'failed' — версия не сохранилась, переход не делаем.
   */
  async function versionBefore(reason: string): Promise<number | null | 'failed'> {
    if (!current) return null
    if (!dirty) return viewing
    const card = current
    const saved = await keep((body) => saveVersion(card.id, { ...body, auto_reason: reason }))
    return saved ? saved.number : 'failed'
  }

  /** «Сохранить как» (Ctrl+Shift+S): новый референс, первая версия — то, что
   *  на экране; у нового записано, от какой версии он пошёл. */
  async function saveCardAs(): Promise<boolean> {
    const saved = await keep(async (body) =>
      saveReference({
        ...body,
        colour_model_id: current?.colour_model_id ?? colourModelId,
        forked_from: current && viewing ? { reference_id: current.id, number: viewing } : null,
      }),
    )
    return saved !== null
  }

  async function keep(send: (body: VersionBody) => Promise<Saved>): Promise<Saved | null> {
    if (saving) return null
    setSaving(true)
    try {
      // Последняя правка черновика доходит раньше версии: иначе запоздавшая
      // запись вернула бы черновик уже после того, как он стал версией.
      await writer.flush()
      // Лист и снимки сторон — одновременно, а не друг за другом.
      const [body, views] = await Promise.all([versionBody(), snapshotSides()])
      if (!body) return null
      const saved = await send({ ...body, views })
      const card = await openReference(saved.id)
      queries.setQueryData(cardKey(saved.id), card)
      // Витрина показывает сохранённое — и меняется только от сохранения:
      // перечитанный список отдаёт прежние карточки теми же объектами, и
      // перерисуется ровно эта (правка владельца 26.09).
      void queries.invalidateQueries({ queryKey: ['references'] })
      if (current && current.id !== saved.id) rememberDraft(queries, current.id, null)
      // Правки легли в версию — черновик сервер убрал сам; при «сохранить
      // как» правки ушли в новый референс, и прежнему они тоже не черновик.
      writer.forget(current?.id ?? null)
      onServer.current = null
      setDraftHeld(null)
      setCurrent(card)
      setViewing(saved.number)
      setBaseline(nowKey)
      setRestored(false)
      setSeenCards(saved.matches)
      return saved
    } catch (e) {
      // Работа не теряется: она на экране и в черновике, повторить — то же
      // сочетание клавиш.
      setDropHint(`Не сохранилось: ${e instanceof Error ? e.message : String(e)} — повторите Ctrl+S.`)
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Снимки переда и спины для витрины (US-0491) — с миниатюр сторон.
   *  Миниатюры идут за работой с задержкой; если последняя правка до них ещё
   *  не дошла — ждём её, иначе на витрине окажется предпоследний вид. Снимок
   *  не сохранился — версия всё равно сохраняется, витрина покажет имя. */
  async function snapshotSides(): Promise<Record<string, string>> {
    if (thumbWork !== sized) {
      // Миниатюры идут за работой с задержкой — догоняем их сразу и ждём два
      // кадра отрисовки, а не паузу наугад. Но не дольше 100 мс: вкладке в
      // фоне браузер кадров не даёт вовсе, и сохранение ждало бы вечно, хотя
      // миниатюры рисуются в эффектах и кадров не требуют.
      setThumbWork(sized)
      await new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
        setTimeout(r, 100)
      })
    }
    const out: Record<string, string> = {}
    await Promise.all(
      ['front', 'back'].map(async (code) => {
        const canvas = thumbCanvases.current[code]
        if (!canvas) return
        try {
          out[code] = await uploadCanvas(shrink(canvas, VIEW_SIZE), `${PRODUCT}-${code}-view.png`)
        } catch {
          // см. выше: без снимка — не повод терять версию
        }
      }),
    )
    return out
  }


  /** Соседняя карточка витрины по A/D (US-0600): в порядке витрины, с её
   *  фильтром. Считается от последней запрошенной, а не от показанной: при
   *  быстрых нажатиях показанная отстаёт. */
  function flip(back: boolean) {
    const order =
      queries.getQueryData<number[]>(ORDER_KEY) ??
      (queries.getQueryData<{ id: number }[]>(['references']) ?? []).map((c) => c.id)
    const from = aimed.current ?? current?.id
    if (from == null || order.length === 0) return
    const at = order.indexOf(from)
    const next = order[at < 0 ? 0 : at + (back ? -1 : 1)]
    if (next === undefined) {
      setDropHint(back ? 'Это первая карточка витрины.' : 'Это последняя карточка витрины.')
      return
    }
    // Открываем сразу, адрес — в том же обработчике: карточка из кэша
    // ложится раньше, чем React отрисует смену адреса, и оба изменения
    // приходят одним кадром — без обложки и без прежней карточки.
    void openCard(next)
    navigate(`/references/${next}`, { replace: true, state: location.state })
  }

  // Соседи по витрине готовятся заранее — данные и картинки: следующее A или
  // D показывает, а не загружает.
  useEffect(() => {
    if (!current) return
    const order = queries.getQueryData<number[]>(ORDER_KEY) ?? []
    const at = order.indexOf(current.id)
    if (at < 0) return
    for (const d of [1, -1, 2, -2]) {
      const id = order[at + d]
      if (id !== undefined) prefetchCard(queries, id)
    }
  }, [current?.id])

  /** Листать историю: соседняя версия открывается целиком. */
  function step(towards: 'older' | 'newer') {
    if (!current || viewing === null) return
    const n = neighbour(
      current.versions.map((v) => v.number),
      viewing,
      towards,
    )
    if (n !== null) goTo(n)
  }

  /** Открыть версию номер n. Черновик не пропадает: он в истории строкой и
   *  заменится, только если править открытую версию. */
  function goTo(n: number) {
    if (!current) return
    const card = current
    void openVersion(card.id, n)
      .then((v) => showVersion(card, n, v.work))
      .catch((e: Error) => setDropHint(`Версия №${n} не открылась: ${e.message}`))
  }

  /** Показать версию референса как сохранили: стороны, цвет, размер. */
  function showVersion(card: ReferenceFull, number: number, work: unknown): boolean {
    const w = work as {
      stateCode?: string
      colourCode?: string
      size?: number | null
      composition?: typeof composition
    } | null
    if (!w?.composition) {
      // Карточка из тех времён, когда сохранялся только снимок для узнавания.
      // Открыть её нечем — и сказано это прямо, а не пустым изделием.
      setDropHint(`«${card.name}» сохранена до того, как карточки стали хранить работу: открыть нечего.`)
      return false
    }
    const c = upgrade(w.composition)
    for (const el of c.elements) if (el.kind === 'image') cacheImage(el.src)
    if (w.stateCode) setStateCode(w.stateCode)
    const colour = w.colourCode ?? colourCode
    setColourCode(colour)
    setSize(w.size ?? null)
    // Открытая версия — без выбранного: панель появляется по нажатию, а не
    // потому, что при сохранении что-то было выделено.
    history.open(card.id, { ...c, selectedId: null })
    setCurrent(card)
    setViewing(number)
    setColourModelId(card.colour_model_id)
    setBaseline(workKey({ colourCode: colour, composition: c }))
    setRestored(false)
    return true
  }

  /** Открыть референс — со своим черновиком, если он есть, иначе последнюю
   *  версию или `at`. Вопроса «восстановить?» нет: черновик и есть работа. */
  async function openCard(id: number, at?: number, fromShowcase = false) {
    // Десять D подряд — десять открытий в полёте; показать надо последнее, а
    // не то, чей ответ пришёл позже.
    aimed.current = id
    const late = () => aimed.current !== id
    // С витрины окно показывается раньше, чем в нём сменится работа: снимок
    // закрывает прежнюю карточку, пока новая не легла.
    if (fromShowcase || !queries.getQueryData(cardKey(id))) {
      const listed = queries.getQueryData<{ id: number; views: Record<string, string> }[]>(['references'])?.find((c) => c.id === id)
      const view = listed?.views[stateCode] ?? listed?.views.front ?? listed?.views.back
      setColdView(view ? assetUrl(view, 'preview') : null)
    }
    try {
      const card = await cardNow(queries, id, (fresh) => {
        // Пока листали, кто-то сохранил новую версию. Своё несохранённое на
        // экране не подменяем — черновик и есть работа.
        if (!late() && !dirtyNow.current) showVersion(fresh, fresh.number, fresh.work)
      })
      if (late()) return
      const draft = newer(card.draft ?? null, readBuffer(id))
      if (draft && !at) {
        await showDraft(card, draft)
        return
      }
      const number = at && card.versions.some((v) => v.number === at) ? at : card.number
      const work = number === card.number ? card.work : (await openVersion(id, number)).work
      if (late()) return
      showVersion(card, number, work)
      setDraftHeld(draft)
    } catch (e) {
      setDropHint(`Референс №${id} не открылся: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (!late()) setColdView(null)
    }
  }

  /** На экране черновик; сравнивается он с версией, поверх которой правили, —
   *  значит, виден как несохранённый. */
  async function showDraft(card: ReferenceFull, draft: DraftBody) {
    const d = draft.work as SavedWork | null
    const at = draft.base_number && card.versions.some((v) => v.number === draft.base_number) ? draft.base_number : card.number
    const base = at === card.number ? card.work : (await openVersion(card.id, at)).work
    if (aimed.current !== null && aimed.current !== card.id) return
    if (!d?.composition) {
      showVersion(card, card.number, card.work)
      return
    }
    const c = upgrade(d.composition)
    const b = base as SavedWork | null
    onServer.current = workKey({ colourCode: d.colourCode ?? colourCode, composition: c })
    for (const el of c.elements) if (el.kind === 'image') cacheImage(el.src)
    if (d.stateCode) setStateCode(d.stateCode)
    setColourCode(d.colourCode ?? colourCode)
    setSize(d.size ?? null)
    history.open(card.id, { ...c, selectedId: null })
    setCurrent(card)
    setViewing(at)
    setColourModelId(card.colour_model_id)
    setBaseline(
      b?.composition ? workKey({ colourCode: b.colourCode ?? 'WHITE', composition: upgrade(b.composition) }) : null,
    )
    setRestored(true)
    setDraftHeld(draft)
  }

  /** Новая, ни разу не сохранённая работа — с её черновиком. */
  async function restoreNew() {
    const draft = newer(await newDraft().catch(() => null), readBuffer(null))
    const d = draft?.work as SavedWork | null | undefined
    if (!draft || !d?.composition) return
    const c = upgrade(d.composition)
    onServer.current = workKey({ colourCode: d.colourCode ?? colourCode, composition: c })
    for (const el of c.elements) if (el.kind === 'image') cacheImage(el.src)
    if (d.stateCode) setStateCode(d.stateCode)
    if (!colourFromDrop && d.colourCode) setColourCode(d.colourCode)
    setSize(d.size ?? null)
    history.open(null, { ...c, selectedId: null })
    setRestored(true)
    setDraftHeld(draft)
  }

  /** «Отбросить черновик»: на экране снова версия, поверх которой правили. */
  async function discard() {
    const card = current
    const at = draftHeld?.base_number ?? card?.number ?? null
    writer.forget(card?.id ?? null)
    await writer.settle()
    onServer.current = null
    if (card) rememberDraft(queries, card.id, null)
    try {
      await discardDraft(card?.id ?? null)
    } catch (e) {
      setDropHint(`Черновик не отброшен: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    setDraftHeld(null)
    if (card && at) goTo(at)
    else {
      commit(EMPTY)
      setBaseline(null)
      setRestored(false)
    }
  }

  /** Печатный лист: сборка из сантиметров, мимо шейдера, в печатном разрешении. */
  async function downloadSheet() {
    if (composition.elements.length === 0) return
    // На фабрику уходит версия, а не черновик: несохранённое сначала станет
    // версией, и её номер будет на листе (US-0599).
    const n = await versionBefore('перед выгрузкой листа')
    if (n === 'failed') return
    const version = current && n ? { id: current.id, number: n } : null
    // По файлу на КАЖДУЮ сторону, где что-то есть. Сведённые в один лист перед
    // и спина дают файл, который на фабрике не печатается ничем: это два
    // разных прогона.
    for (const side of Object.keys(sidesUsed(composition))) {
      downloadSheetOf(side, version)
    }
  }

  function downloadSheetOf(side: string, version: { id: number; number: number } | null) {
    const only = onSide(sized, side)
    // Лист выгружают из открытого окна — изделие к этому времени загружено.
    if (only.elements.length === 0 || !product) return
    const cal = product.calibration
    // 120 пикселей на сантиметр — около 300 точек на дюйм, обычное печатное
    // разрешение. Число названо здесь, а не спрятано: оно уйдёт на фабрику.
    const spec = describeSheet(only, clips)
    const canvas = renderSheet(only, images.current, 120, clips)

    // Пометка о предварительной калибровке НЕ впечатывается в лист: его
    // напечатают вместе с ней. Она уходит в имя файла и в сопроводительную
    // спецификацию — от файла они не отвяжутся, а на ткань не попадут.
    const mark = cal.provisional ? '-PREDVARITELNO' : ''
    // Размер — в имени файла: на фабрику уходит лист каждого размера, и
    // безымянный лист на 98 неотличим от листа на 164.
    const stem =
      PRODUCT + '-' + side + '-' + (size ?? grid?.base ?? 'baza') + (version ? `-ref${version.id}-v${version.number}` : '') + mark

    const save = (blob: Blob, name: string) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    }

    const lines = [
      'Изделие: ' + PRODUCT + ', сторона: ' + (SIDE_NAMES[side] ?? side),
      version
        ? `Референс №${version.id}, версия ${version.number} — лист совпадает с ней`
        : 'Референс не сохранён — лист без версии',
      'Габарит печати: ' + spec.widthCm.toFixed(1) + ' x ' + spec.heightCm.toFixed(1) + ' см',
      'Разрешение файла: 120 px/см (около 300 dpi)',
      cal.provisional
        ? 'ВНИМАНИЕ: калибровка изделия предварительная (' +
          cal.px_per_cm +
          ' px/см, ' +
          (cal.derived_from ?? '') +
          '). Размеры ниже уточнятся после измерения.'
        : 'Калибровка изделия измерена.',
      '',
      ...spec.items.map(
        (i) =>
          '- ' +
          i.name +
          ': ' +
          i.widthCm.toFixed(1) +
          ' x ' +
          i.heightCm.toFixed(1) +
          ' см, от ориентира ' +
          i.anchor +
          ': вниз ' +
          i.dyCm.toFixed(1) +
          ' см, вбок ' +
          i.dxCm.toFixed(1) +
          ' см, поворот ' +
          i.rotation +
          ' град',
      ),
    ]
    save(new Blob([lines.join(String.fromCharCode(10))], { type: 'text/plain' }), stem + '-specifikaciya.txt')
    canvas.toBlob((blob) => blob && save(blob, stem + '-pechatnyy-list.png'), 'image/png')
  }

  /**
   * Снимок стенда картинкой.
   *
   * Стенд живёт в докере на одной машине, и показать его команде можно только
   * позвав людей к экрану. Картинку кидают в мессенджер — значит мнение
   * Виктории и редакторов появится сейчас, а не через два месяца, когда
   * система будет готова их принять.
   *
   * Это НЕ печатный лист: тот плоский и идёт на фабрику, а здесь изделие со
   * складками, тенью и цветом — как его увидит человек.
   */
  function downloadSnapshot() {
    const canvas = viewCanvas.current
    if (!canvas) return
    const colour = colours.find((c) => c.code === colourCode)?.code_short ?? colourCode
    canvas.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      // Имя говорит, что на снимке: три снимка в мессенджере без подписей
      // неразличимы, и обсуждение превращается в «а это какой из них».
      a.download = `${PRODUCT}-${stateCode}-${colour}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    }, 'image/png')
  }

  function addLabel() {
    const style = {
      text: 'ЗИМА 2026',
      fontFamily: DEFAULT_FONT.family,
      weight: 600,
      rgb: [255, 255, 255] as const,
    }
    const el: TextElement = {
      id: newElementId(),
      kind: 'text',
      name: 'надпись',
      ...style,
      colourCode: 'WHITE',
      textAspect: aspectOf(style),
      placement: { side: stateCode, anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
    }
    commit((c) => add(c, el))
  }

  /** Положить выбранное (US-0507): картинку из библиотеки — как есть, фразу —
   *  надписью тем шрифтом, которым она уже стоит в референсах. Не из
   *  одобренного к дропу — сказать об этом сразу. */
  function pick(p: Picked) {
    if (p.kind === 'image') addFromLibrary(p.key, p.title)
    else void addPhrase(p.title, p.key)
    if (!p.approved && refDropIds.length) {
      setDropHint(`«${p.title}» не одобрено к этому дропу — на изделии оно отмечено.`)
    }
  }

  function addFromLibrary(digest: string, name: string) {
    if (refusedHere()) return
    const src = assetUrl(digest, 'preview')
    void probeImage(src).then(({ aspect, hasAlpha }) => {
      cacheImage(src)
      commit((c) =>
        add(c, {
          id: newElementId(),
          kind: 'image',
          name,
          src,
          aspect,
          hasAlpha,
          placement: { side: stateCode, anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
        }),
      )
    })
  }

  async function addPhrase(text: string, key: string) {
    if (refusedHere()) return
    let font = DEFAULT_FONT.family
    try {
      const rows = await queries.fetchQuery({ queryKey: ['texts', ''], queryFn: () => fetchTexts(''), staleTime: 30_000 })
      font = rows.find((r) => r.key === key)?.fonts[0] ?? font
    } catch {
      // Шрифт не узнали — надпись встанет шрифтом по умолчанию.
    }
    const style = { text, fontFamily: font, weight: 600, rgb: [255, 255, 255] as const }
    commit((c) =>
      add(c, {
        id: newElementId(),
        kind: 'text',
        name: 'надпись',
        ...style,
        colourCode: 'WHITE',
        textAspect: aspectOf(style),
        placement: { side: stateCode, anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
      }),
    )
  }

  /** Закрыть окно — туда, откуда открыли: шагом назад по истории, чтобы
   *  «назад» после закрытия не открывало окно снова. Открыли прямой ссылкой —
   *  на витрину. Вопроса нет: несохранённое осталось черновиком.
   *
   *  «Открыто изнутри» (витрина, «Мои задачи») — пометка в состоянии перехода, а не `location.key`: листание
   *  A/D меняет адрес с заменой, и ключ у открытого ссылкой становится не
   *  'default' — шаг назад приводил на ту же ссылку, окно не закрывалось. */
  function close() {
    if ((location.state as { inApp?: boolean } | null)?.inApp) navigate(-1)
    else navigate('/references', { replace: true })
  }

  /** «Перенести на спину» («на перед»): тот же размер и высота, вид идёт
   *  следом за принтом — проверки сразу по зонам новой стороны. */
  function moveSelected(to: string) {
    if (!selected) return
    const anchors = Object.keys(product?.states.find((s) => s.code === to)?.anchors ?? {})
    const id = selected.id
    commit((c) => select(moveToSide(c, id, to, anchors), id))
    setStateCode(to)
  }

  function refusedHere(): boolean {
    if (state?.kind !== 'illustrative') return false
    setDropHint(
      'Это иллюстративный ракурс — по нему нельзя считать размер. ' +
        'Нанесите на перед или спину, здесь принт будет виден сам.',
    )
    return true
  }

  /** Файлы на изделие — один путь для всех входов: брошенные с диска и
   *  принты из набора. Отдельный путь для набора и оставлял его принты без
   *  хранилища, вектора и узнавания. */
  async function addFiles(files: File[], widthCm = 18) {
    if (files.length === 0 || refusedHere()) return
    const read = await Promise.all(files.map(readDropped))
      // Файлы уходят в хранилище: ссылка на ступень переживает перезагрузку,
      // а ссылка на blob — нет.
      let sources = read.map((d) => d.src)
      let refusal: string | null = null
      try {
        const stored = await uploadAssets(files)
        sources = stored.map((a) => assetUrl(a.digest, 'preview'))
        // Тот же ФАЙЛ виден сразу: его поймал хеш, модель для этого не
        // нужна. Вектор ловит другое — ту же картинку в другом файле, — и эти
        // две сети не подменяют друг друга.
        const repeats: Match[] = stored
          .filter((a) => a.reused)
          .map((a) => ({ digest: a.digest, name: a.name, similarity: 1, level: 'file' as const }))
        setSeen(repeats)
        // Узнавание НЕ ожидается: человек бросил картинки и работает дальше,
        // а окно появится, когда модель досчитает.
        void recogniseAssets(stored.map((a) => a.digest))
          .then((rows) => {
            // Забракованная на изделие не ложится (US-0499): её снимаем сразу,
            // как узнали, и говорим почему — тем же файлом или пересохранённой.
            const bad = rows.filter((r) => r.defect)
            if (bad.length) {
              const srcs = new Set(bad.map((r) => assetUrl(r.digest, 'preview')))
              commit((c) => c.elements.filter((el) => el.kind === 'image' && srcs.has(el.src)).reduce((acc, el) => remove(acc, el.id), c))
              setDropHint(bad.map((r) => `Не положено — ${defectText(r.defect!)}`).join(' '))
            }
            setSeen([...repeats, ...rows.flatMap((r) => r.matches)])
            setTagsOf((m) => ({
              ...m,
              ...Object.fromEntries(rows.map((r) => [r.digest, { tags: r.tags, name: r.name ?? null }])),
            }))
          })
          .catch(() => {
            // Не узналось из-за сбоя — молчим. Сообщение о неработающем
            // узнавании не помогает делать принт и отвлекает от работы.
          })
      } catch (e) {
        // Хранилище не ответило — работаем с тем, что в браузере. Потерять
        // возможность приложить картинку хуже, чем потерять её сохранение.
        // Если оно отказало с причиной — показываем причину: «не ответило»
        // про слишком большой файл увело бы человека не туда.
        const reason = e instanceof UploadRefused ? e.reason : null
        refusal =
          (reason ?? 'Файлы не сохранились: хранилище не ответило.') +
          ' Работа продолжается, но перезагрузка их потеряет.'
      }
      sources.forEach((s) => cacheImage(s))
      const opaque = read.filter((d) => !d.hasAlpha)
      const opaqueHint =
        opaque.length === 0
          ? null
          : `Фон не вырезан: ${opaque.map((d) => d.name).join(', ')}. ` +
            'Такая картинка ляжет на изделие прямоугольником — это не поломка, ' +
            'а то, как выглядит непрозрачный файл.'
      // Подсказки ставятся ОДИН раз и вместе. Раньше вторая затирала первую:
      // причина отказа хранилища пропадала сразу, потому что подсказка про
      // фон у обычной картинки пустая.
      setDropHint([refusal, opaqueHint].filter(Boolean).join(' ') || null)
      commit((c) =>
        read.reduce((acc, d, i) => {
          const el: ImageElement = {
            id: newElementId(),
            kind: 'image',
            name: d.name,
            src: sources[i],
            aspect: d.aspect,
            hasAlpha: d.hasAlpha,
            placement: {
              side: stateCode,
              anchor: 'neck',
              dxCm: 0,
              // Бросили несколько — раскладываем лесенкой, иначе они лягут
              // друг на друга и выбрать нижний будет нечем.
              dyCm: 12 + i * 2,
              widthCm,
              rotation: 0,
            },
          }
          return add(acc, el)
        }, c),
      )
  }

  // Эффект открытия окна (windowState) зовёт эти два через мост.
  s.opening.current = { openCard, restoreNew }
  return {
    refusedHere,
    addFiles,
    keyOf,
    open,
    aspectOf,
    addFromSet,
    cacheImage,
    zoomTo,
    clampPan,
    versionBody,
    saveCard,
    versionBefore,
    saveCardAs,
    keep,
    snapshotSides,
    flip,
    step,
    goTo,
    showVersion,
    openCard,
    showDraft,
    restoreNew,
    discard,
    downloadSheet,
    downloadSheetOf,
    downloadSnapshot,
    addLabel,
    pick,
    addFromLibrary,
    addPhrase,
    close,
    moveSelected,
  }
}
export type WindowActions = ReturnType<typeof useWindowActions>
