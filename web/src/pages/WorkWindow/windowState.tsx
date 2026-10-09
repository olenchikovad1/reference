import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { DEFAULT_PARAMS, type RenderParams } from '../../candidates/renderer'
import { fetchPalette, type Colour } from '../../shared/api/colours'
import { fetchPrints, type PrintItem } from '../../shared/api/prints'
import { productQuery, type Product } from '../../shared/api/products'
import { EMPTY, find, place, type Composition } from '../../shared/composition'
import { FONTS } from '../../shared/fonts'
import type { FileTags, Match } from '../../shared/api/assets'
import { digestOf, fetchTags } from '../../shared/api/assets'
import type { ReferenceMatch } from '../../shared/api/references'
import { fetchRemarks, isHearing } from '../../shared/api/references'
import { type RefTags, type ReferenceFull } from '../../shared/api/references'
import { CODE } from '../../app/shell'
import { useCan } from '../../shared/api/platform'
import { useDismiss } from '../../shared/useDismiss'
import { onSide, sidesUsed } from '../../shared/sides'
import { fetchBoard, fetchCatalogue, fetchDrops } from '../../shared/api/drops'
import { approvedIn } from '../WorkPicker'
import { buildTorso, projectRect, toSurface } from '../../shared/torso'
import { editAtSize, gradeOf, graded } from '../../shared/grading'
import { useDraftWriter, type DraftBody } from '../../shared/draftWriter'
import { rememberDraft } from '../../shared/cardCache'
import { imageCache } from '../../shared/imageCache'
import { workKey } from '../../shared/versions'
import { check } from '../../shared/checks'
import { checkZones, clipOutline } from '../../shared/zones'
import { calibrationFor, fieldFor, fieldSize } from '../../shared/fields'
import { type Clips } from '../../shared/sheet'
import { useHistoryState } from '../../shared/useHistory'
import { sameWork } from './work'
import { type PendingRemark } from './remarks'
import { type Overlay, PRODUCT, type SideFinding } from './constants'

// Состояние рабочего окна и то, что из него вычисляется (план 114, US-0894):
// изделие, размер, стороны, работа и её история, поле, проверки, черновик.

export function useWindowState() {
  // Мост к действиям для эффекта открытия: сами действия объявлены в
  // следующем хуке, а порядок эффектов должен остаться прежним.
  const opening = useRef<{ openCard: (id: number) => Promise<unknown>; restoreNew: () => Promise<unknown> } | null>(null)
  // Номер референса из адреса окна; new — новый (цветомодель — в ?colour_model);
  // нет — окно закрыто, но живёт скрытым (US-0600).
  const { ref } = useParams()
  const windowOpen = ref !== undefined
  const navigate = useNavigate()
  const location = useLocation()
  const queries = useQueryClient()
  // Из кэша сразу, а не промисом: окно, открытое второй раз, не должно
  // проходить через «Загружаю изделие…» ни на кадр (US-0600).
  // Код изделия из адреса (?product=) или стендовый по умолчанию (US-0886).
  const productCode =
    new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('product') ?? PRODUCT
  const [product, setProduct] = useState<Product | null>(
    () => queries.getQueryData<Product>(productQuery(productCode).queryKey) ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  const [stateCode, setStateCode] = useState('front')
  // Размер изделия. Печатное поле идёт за ним: принт, помещающийся на 164,
  // на 98 не влезает вдвое, и узнать это надо здесь, а не на фабрике.
  const [size, setSize] = useState<number | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('zones')
  // У каждого референса своя история (US-0683): отмена не приносит работу
  // соседнего. «То же» — без выбранного: выбор не часть работы.
  const history = useHistoryState<Composition>(EMPTY, sameWork)
  const composition = history.value
  // Живое изменение — без записи; шаг закрепляется там, где действие кончилось.
  const setComposition = history.set
  const commit = history.commit
  const [dropHint, setDropHint] = useState<string | null>(null)
  const [params, setParams] = useState<RenderParams>(DEFAULT_PARAMS)
  const [renderScale, setRenderScale] = useState(2)
  const [fps, setFps] = useState<number | null>(null)
  const [colours, setColours] = useState<Colour[]>(() => queries.getQueryData<{ colors: Colour[] }>(['palette'])?.colors ?? [])
  // Цвет из ячейки дропа главнее восстановленной прошлой работы: человек
  // пришёл рисовать именно на этой цветомодели.
  const colourFromDrop = new URLSearchParams(window.location.search).get('colour')
  const [colourCode, setColourCode] = useState(colourFromDrop ?? 'WHITE')
  // Цветомодель из ячейки дропа (US-0489): примерка открывается в её цвете и
  // запоминает её при сохранении. Нет — референс пока без цветомодели.
  const [colourModelId, setColourModelId] = useState<number | null>(() => {
    const v = new URLSearchParams(window.location.search).get('colour_model')
    return v ? Number(v) : null
  })
  // Дроп семьи из ячейки матрицы (US-0890); пусто — сервер возьмёт первый дроп цвета.
  const [dropId, setDropId] = useState<number | null>(() => {
    const v = new URLSearchParams(window.location.search).get('drop')
    return v ? Number(v) : null
  })
  const [fontsReady, setFontsReady] = useState(false)
  const [prints, setPrints] = useState<PrintItem[]>(() => queries.getQueryData<PrintItem[]>(['prints']) ?? [])
  // Кэш картинок один на страницу: им пользуются и холст, и печатный лист.
  // Картинки — общие на вкладку (US-0600): соседняя карточка и повторное
  // открытие берут их из памяти, а не качают заново.
  const images = useRef(imageCache)
  const [imagesVersion, setImagesVersion] = useState(0)
  const [restored, setRestored] = useState(false)
  // Приближение показа. НЕ размер принта: приблизить показ и увеличить принт —
  // разные действия, и второе уходит на фабрику.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  // Нажатие на холст: протянули — сдвиг вида, не протянули — щелчок (по
  // изделию — его панель, мимо — всё закрыть).
  const press = useRef<{
    x: number
    y: number
    px: number
    py: number
    moved: boolean
    svg: SVGSVGElement | null
  } | null>(null)
  // Сторона квадрата показа: всё, что оставили холсту полоса и панель.
  const [box, setBox] = useState(620)
  const area = useRef<HTMLDivElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  // Выбрано изделие (не принт): панель его цвета, размера и показа.
  const [garmentPicked, setGarmentPicked] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Свои теги и скрытые автотеги открытого референса (US-0493).
  const [refTags, setRefTags] = useState<RefTags | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [tagHints, setTagHints] = useState<string[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  // Какую основную краску принта меняем и какие краски выбраны для дуотона.
  const [swapPick, setSwapPick] = useState<number | null>(null)
  const [duoPick, setDuoPick] = useState<string[]>([])
  // Узнанное. Пусто — окна нет вовсе: окно «совпадений нет» превращает
  // подсказку в помеху, и его перестают читать вместе с полезными.
  const [seen, setSeen] = useState<Match[]>([])
  // Узнанное при сохранении собранного принта. Отдельно от seen: там
  // совпадают ФАЙЛЫ, здесь — собранные принты, и выводы разные.
  const [seenCards, setSeenCards] = useState<ReferenceMatch[]>([])
  // Сохранённые карточки. Грузятся при открытии и после каждого сохранения.
  // Нет права записи на «Референсах» — кнопки сохранения нет вовсе, а не
  // есть и отказывает; сервис и сам ответит «нет такого пути» (US-0487).
  const canSave = useCan(CODE, 'references', 'write')
  // Брак картинки — функция раздела «Принты» (план 095: прямо из окна).
  const canDefect = useCan(CODE, 'prints', 'mark-defect')
  // Теги файлов по имени файла. Ставятся сами при узнавании; для уже
  // лежащих — досчитываются по сохранённому вектору.
  const [tagsOf, setTagsOf] = useState<Record<string, FileTags>>({})
  // Открытый референс и версия на экране (US-0490). null — работа ещё не
  // сохранялась ни разу: «Сохранить» заведёт новый референс.
  const [current, setCurrent] = useState<ReferenceFull | null>(null)
  // Замечания (US-0511): список, режим «поставить», точка до текста и
  // замечание, на котором стоит фокус клавиш N/R/F.
  const remarks = useQuery({
    queryKey: ['remarks', current?.id ?? 0],
    queryFn: () => fetchRemarks(current!.id),
    enabled: !!current,
    // Пока что-то расшифровывается — переспрашивать: текст появится сам.
    refetchInterval: (q) => ((q.state.data ?? []).some(isHearing) ? 1500 : false),
  })
  const [placing, setPlacing] = useState(false)
  // Панель обсуждения (US-0689): согласование, замечания, исполнитель — своей
  // колонкой по круглой кнопке, а не в длинной полосе справа. Открыта или нет
  // — помнит браузер; мой ход — открывается сама.
  // Всплывающим окном и только по нажатию (план 095): открытое само или
  // запомненное прятало правую полосу, и работать было нельзя.
  const [talkOpen, setTalkOpen] = useState(false)
  const talkRef = useRef<HTMLDivElement | null>(null)
  const closeTalk = useCallback(() => setTalkOpen(false), [])
  const [pendingRemark, setPendingRemark] = useState<PendingRemark | null>(null)
  const [focusRemark, setFocusRemark] = useState<number | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  // Отпечаток открытой версии, с ним сравнивается экран. null — сравнивать не
  // с чем: несохранённое — всё, что есть на холсте.
  const [baseline, setBaseline] = useState<string | null>(null)
  // Черновик между версиями (US-0598): пишется сам на каждое действие,
  // вопроса «сохранить?» при уходе нет. draftHeld — мой черновик к открытой
  // работе, даже когда на экране версия: строка «несохранённые изменения» в
  // истории открывает его обратно.
  const { writer, status: draftStatus } = useDraftWriter()
  // Карточка, которую открываем последней (US-0600): по ней считается соседняя
  // при быстрых A/D и отбрасываются запоздавшие ответы.
  const aimed = useRef<number | null>(null)
  // Снимок витрины, пока карточка ещё не пришла (US-0600): открытие с витрины
  // показывает изделие сразу, работа подменяет снимок, когда готова.
  const [coldView, setColdView] = useState<string | null>(null)
  const [draftHeld, setDraftHeld] = useState<DraftBody | null>(null)
  // Раскрытые пачки автоверсий в истории — по номеру верхней в пачке.
  const [openAutos, setOpenAutos] = useState<Set<number>>(new Set())
  // Отпечаток работы, которая уже лежит на сервере черновиком: открытый
  // черновик переписывать самим собой незачем — эта запись и гонялась с
  // «отбросить».
  const onServer = useRef<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const missing = [
      ...new Set(
        composition.elements
          .filter((el) => el.kind === 'image')
          .map((el) => digestOf(el.src))
          .filter((d) => d && !(d in tagsOf)),
      ),
    ]
    if (missing.length === 0) return
    void fetchTags(missing)
      .then((got) => setTagsOf((m) => ({ ...m, ...got })))
      .catch(() => undefined)
  }, [composition.elements])
  // Закрытые предупреждения: «так и задумано». Ключ — правило плюс элемент.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const viewCanvas = useRef<HTMLCanvasElement | null>(null)
  // Холсты миниатюр по сторонам: с них снимаются виды для витрины при
  // сохранении — они уже нарисованы, второй раз рисовать изделие незачем.
  const thumbCanvases = useRef<Record<string, HTMLCanvasElement | null>>({})
  const measurer = useRef<CanvasRenderingContext2D | null>(null)

  useEffect(() => {
    // Изделие, палитра и набор одни на все карточки: грузятся один раз за
    // вкладку и берутся из кэша при каждом следующем открытии окна.
    queries.fetchQuery(productQuery(productCode)).then(setProduct).catch((e: Error) => setError(e.message))
    queries
      .fetchQuery({ queryKey: ['palette'], queryFn: fetchPalette, staleTime: Infinity })
      .then((p) => setColours(p.colors))
      .catch(() => undefined)
    queries
      .fetchQuery({ queryKey: ['prints'], queryFn: fetchPrints, staleTime: Infinity })
      .then(setPrints)
      .catch(() => undefined)
    // Браузер грузит шрифт лениво — до первого применения. Без явного ожидания
    // первая отрисовка надписи уходит в запасной шрифт, то есть показывает не
    // то, что уйдёт в печать, и заметить это трудно: буквы-то на месте.
    const asked = Number(ref)
    // Референс из адреса окна — со своим черновиком, если он есть; новая
    // работа — с черновиком новой работы; закрытое окно ждёт.
    // Открывают действия (windowActions) — они объявлены позже этого хука и
    // кладут себя в opening при отрисовке; эффект идёт после неё.
    if (asked) void opening.current?.openCard(asked)
    else if (ref === 'new') void opening.current?.restoreNew()
    void Promise.all(FONTS.map((f) => document.fonts.load(`600 100px "${f.family}"`)))
      .then(() => setFontsReady(true))
      .catch(() => setFontsReady(true))
  }, [])

  // Изделие с кадров — из ?product= (цветомодель plm), иначе стендовый код.
  useEffect(() => {
    queries.fetchQuery(productQuery(productCode)).then(setProduct).catch((e: Error) => setError(e.message))
  }, [productCode, queries])

  const state = product?.states.find((s) => s.code === stateCode) ?? product?.states[0] ?? null
  // Калибровка ВЫБРАННОГО размера: от неё зависят и показ, и проверки, и
  // перетаскивание. Одна на всех — разложенная по местам, она разошлась бы, и
  // принт на экране оказался бы не того размера, что в проверке.
  const grid = product?.size_grid ?? null
  const grade = gradeOf(grid, size)
  // Опущенный капюшон на выбранном размере: его длина растёт медленнее груди,
  // а кадр показывает любой размер одним рисунком — зона на кадре меняется во
  // столько раз, во сколько капюшон вырос относительно изделия (US-0519).
  const hoodLen = product?.hood_down?.length_cm_by_size
  const hoodBase = hoodLen?.[String(grid?.base ?? 134)]
  const hoodNow = hoodLen && size !== null ? hoodLen[String(size)] : undefined
  const hoodDownScale = hoodBase && hoodNow ? hoodNow / hoodBase / grade : 1
  const calibration = useMemo(
    () => calibrationFor({ pxPerCm: product?.calibration.px_per_cm ?? 1, provisional: true }, grade),
    [product, grade],
  )
  // Работа на выбранном размере. Хранится она в базовом, а показ, проверки
  // и печатный лист смотрят на неё в сантиметрах выбранного размера.
  const sized = useMemo(() => graded(composition, grid, size), [composition, grid, size])
  /** Правка на размере — в единицах базы: иначе переключение размера тихо
   *  переписывало бы то, от чего считаются все остальные. */
  const placeSized = (c: typeof composition, id: string, patch: Parameters<typeof place>[2]) => {
    // Правка ширины не на базовом размере — исключение этого размера, а не
    // новая база: остальные размеры остаются по сетке.
    const el = c.elements.find((e) => e.id === id)
    return el ? place(c, id, editAtSize(el.placement, patch, grid, size)) : c
  }
  // Вид на ТЕКУЩУЮ сторону. Правки идут в полную композицию по id, поэтому
  // переключение стороны ничего не теряет: отбор — это взгляд, а не правка.
  const visible = useMemo(() => onSide(sized, stateCode), [sized, stateCode])
  // Миниатюры сторон идут за работой с задержкой, а не на каждом кадре
  // перетаскивания: три отрисовки сверх основной на каждое движение руки —
  // цена, а миниатюре достаточно показать, где рука остановилась.
  const [thumbWork, setThumbWork] = useState(sized)
  useEffect(() => {
    const t = setTimeout(() => setThumbWork(sized), 150)
    return () => clearTimeout(t)
  }, [sized])
  // Объём торса при калибровке выбранного размера: сантиметры ткани на
  // 98 и на 164 — разные пиксели одного и того же кадра.
  const torso = useMemo(
    () => (product?.torso ? buildTorso(product.torso, calibration.pxPerCm) : null),
    [product, calibration],
  )
  const anchorsBySide = useMemo(
    () => Object.fromEntries((product?.states ?? []).map((s) => [s.code, s.anchors])),
    [product],
  )
  // Что лежит на других сторонах. Без этого про спину забывают и сдают
  // половину работы.
  const elsewhere = useMemo(() => {
    const counts = sidesUsed(composition)
    delete counts[stateCode]
    return counts
  }, [composition, stateCode])

  // Свойства правятся у ВИДИМОГО элемента. Из полной композиции сюда попадал
  // бы выделенный на другой стороне: панель показывает одно, экран другое, и
  // правка уходит в невидимое — заметить это можно только по чужому кадру.
  // Поле выбранного размера. null — для этого размера технолог поля не дал,
  // и тогда считаем по зоне кадра, сказав об этом человеку.
  const field = useMemo(
    () => fieldFor(product?.print_fields ?? null, size ?? 0, stateCode, state?.zones?.print, calibration),
    [product, size, stateCode, state, calibration],
  )

  // Поле размера в сантиметрах ткани и его контур на кадре. С объёмом контур
  // идёт через модель, как принт: плоский прямоугольник на 164 вылезал бы за
  // торс, хотя по ткани поле на нём укладывается.
  const fieldCm = useMemo(
    () => fieldSize(product?.print_fields ?? null, size, stateCode),
    [product, size, stateCode],
  )
  const fieldOutline = useMemo(() => {
    const zone = state?.zones?.print
    const panel = stateCode === 'front' || stateCode === 'back' ? stateCode : null
    if (!torso || !panel || !fieldCm || !zone || !torso.views[stateCode]) return field
    const xs = zone.map((p) => p[0])
    const ys = zone.map((p) => p[1])
    const s = toSurface(
      torso,
      stateCode,
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    )
    if (!s) return field
    const centre = { u: panel === 'front' ? s.uFront : s.uBack, h: s.h }
    return projectRect(torso, stateCode, panel, centre, fieldCm[0], fieldCm[1], 0, 12)
  }, [torso, stateCode, fieldCm, state, field])

  // Обрезка по разметке (US-0505): контур каждого элемента от его ориентира,
  // на ВЫБРАННОМ размере — поле 98 и поле 164 разные. Один на показ, листы и
  // миниатюры: граница, по которой режут, везде одна.
  const clips: Clips = useMemo(() => {
    const out = new Map<string, readonly (readonly [number, number])[]>()
    if (!product) return out
    for (const el of sized.elements) {
      if (!el.placement.clip) continue
      const s = product.states.find((x) => x.code === (el.placement.side ?? 'front'))
      if (!s) continue
      const sField = fieldFor(product.print_fields ?? null, size ?? 0, s.code, s.zones?.print, calibration)
      const sFieldCm = fieldSize(product.print_fields ?? null, size, s.code)
      const poly = clipOutline(el, s, calibration, sField, torso ? { torso, anchors: s.anchors, fieldCm: sFieldCm } : null)
      if (poly) out.set(el.id, poly)
    }
    return out
  }, [sized, product, size, calibration, torso])

  const selected = find(visible, visible.selectedId)
  // Выбор красок дуотона — у каждого принта свой: другой принт — выбор с нуля.
  useEffect(() => setDuoPick([]), [visible.selectedId])
  const [cropMenu, setCropMenu] = useState(false)
  const cropRef = useRef<HTMLDivElement | null>(null)
  const closeCropMenu = useCallback(() => setCropMenu(false), [])
  useDismiss(cropMenu, closeCropMenu, [cropRef])
  const [cropOpen, setCropOpen] = useState(false)
  useEffect(() => {
    setCropMenu(false)
    setCropOpen(false)
  }, [visible.selectedId])

  // Несохранённое — отличие экрана от открытой версии; у несохранённой ни разу
  // работы — всё, что на холсте.
  const nowKey = workKey({ colourCode, composition })
  const dirty = baseline === null ? composition.elements.length > 0 : nowKey !== baseline
  const dirtyNow = useRef(dirty)
  dirtyNow.current = dirty

  // Черновик пишется сам, пока экран отличается от версии (US-0598). Пишется
  // закреплённое: живое перетаскивание не меняет отпечаток работы, выбор
  // принта — тоже. Писатель сам ждёт, пока рука остановится, и шлёт одну
  // запись на пачку правок.
  useEffect(() => {
    if (!dirty || nowKey === onServer.current) return
    onServer.current = nowKey
    const body: DraftBody = {
      work: { version: 2, stateCode, colourCode, size, composition: { ...composition, selectedId: null } },
      base_number: current ? viewing : null,
    }
    writer.change(current?.id ?? null, body)
    if (current) rememberDraft(queries, current.id, body)
    setDraftHeld(body)
  }, [nowKey, dirty])

  // Пороги приходят из описания изделия, а не из кода.
  const rules = product?.print_rules
  // Две группы находок, а не одна: первая считается из самого принта и верна на
  // любом изделии, вторая — из КАДРА, и без состояния её посчитать нечем.
  // Находки считаются по ОТЛОЖЕННОЙ композиции: во время перетаскивания
  // панели проверок незачем обновляться на каждый кадр, а считаются они по
  // ткани дороже, чем рисуется сам принт. Отстают на кадр-другой и догоняют,
  // как только рука остановилась.
  // Проверки — по ВСЕМ точным сторонам, а не по открытой: пересечённая молния
  // на переде не исчезает оттого, что смотрят на спину (правка владельца 25.09).
  const checked = useDeferredValue(sized)
  const findings: SideFinding[] = useMemo(
    () =>
      (product?.states ?? [])
        .filter((s) => s.kind !== 'illustrative')
        .flatMap((s) => {
          const side = onSide(checked, s.code)
          if (side.elements.length === 0) return []
          const sideField = fieldFor(product?.print_fields ?? null, size ?? 0, s.code, s.zones?.print, calibration)
          const sideFieldCm = fieldSize(product?.print_fields ?? null, size, s.code)
          return [
            ...checkZones(
              side,
              s,
              calibration,
              sideField,
              torso ? { torso, anchors: s.anchors, fieldCm: sideFieldCm } : null,
              hoodDownScale,
              {
                printField: product?.checks?.print_field,
                hood: product?.checks?.hood,
              },
            ),
            ...check(
              side,
              rules
                ? {
                    minLetterCm: rules.min_letter_cm,
                    warnLetterCm: rules.warn_letter_cm,
                    minStrokeCm: rules.min_stroke_cm,
                    maxColours: rules.max_colours,
                  }
                : undefined,
            ),
          ].map((f) => ({ ...f, side: s.code }))
        }),
    [checked, product, size, calibration, torso, hoodDownScale, rules],
  )
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue, staleTime: 60_000 })
  const cmId = current?.colour_model_id ?? colourModelId
  const refDropIds = useMemo(() => {
    const walk = (nodes: typeof catalogue.data): number[] =>
      (nodes ?? []).flatMap((n) => [
        ...n.models.flatMap((m) => m.colour_models.filter((cm) => cm.id === cmId).flatMap((cm) => cm.drop_ids)),
        ...walk(n.children),
      ])
    return cmId ? walk(catalogue.data) : []
  }, [catalogue.data, cmId])
  const dropList = useQuery({ queryKey: ['drops'], queryFn: fetchDrops, staleTime: 60_000 })
  const catalogueDropName = (id: number) => dropList.data?.find((d) => d.id === id)?.name
  const board = useQuery({
    queryKey: ['drops', refDropIds[0], 'board'],
    queryFn: () => fetchBoard(refDropIds[0]),
    enabled: refDropIds.length > 0,
  })
  const approved = approvedIn(board.data)
  const isApproved = (el: (typeof composition.elements)[number]) =>
    el.kind === 'image' ? approved.has(`image:${digestOf(el.src)}`) : approved.has(`text:${el.text.replace(/\s+/g, ' ').trim().toUpperCase()}`)

  // Цвета для сравнения (US-0500): из ассортимента дропа референса, иначе
  // вся палитра; у каждого — цветомодель этого изделия, если она есть.
  return {
    opening,
    catalogue,
    cmId,
    refDropIds,
    dropList,
    catalogueDropName,
    board,
    approved,
    isApproved,
    ref,
    windowOpen,
    navigate,
    location,
    queries,
    product,
    setProduct,
    error,
    setError,
    stateCode,
    setStateCode,
    size,
    setSize,
    overlay,
    setOverlay,
    history,
    composition,
    setComposition,
    commit,
    dropHint,
    setDropHint,
    params,
    setParams,
    renderScale,
    setRenderScale,
    fps,
    setFps,
    colours,
    setColours,
    colourFromDrop,
    colourCode,
    setColourCode,
    colourModelId,
    setColourModelId,
    dropId,
    setDropId,
    fontsReady,
    setFontsReady,
    prints,
    setPrints,
    images,
    imagesVersion,
    setImagesVersion,
    restored,
    setRestored,
    zoom,
    setZoom,
    pan,
    setPan,
    press,
    box,
    setBox,
    area,
    stage,
    garmentPicked,
    setGarmentPicked,
    helpOpen,
    setHelpOpen,
    refTags,
    setRefTags,
    tagDraft,
    setTagDraft,
    tagHints,
    setTagHints,
    libraryOpen,
    setLibraryOpen,
    compareOpen,
    setCompareOpen,
    swapPick,
    setSwapPick,
    duoPick,
    setDuoPick,
    seen,
    setSeen,
    seenCards,
    setSeenCards,
    canSave,
    canDefect,
    tagsOf,
    setTagsOf,
    current,
    setCurrent,
    remarks,
    placing,
    setPlacing,
    talkOpen,
    setTalkOpen,
    talkRef,
    closeTalk,
    pendingRemark,
    setPendingRemark,
    focusRemark,
    setFocusRemark,
    viewing,
    setViewing,
    baseline,
    setBaseline,
    writer,
    draftStatus,
    aimed,
    coldView,
    setColdView,
    draftHeld,
    setDraftHeld,
    openAutos,
    setOpenAutos,
    onServer,
    saving,
    setSaving,
    dismissed,
    setDismissed,
    viewCanvas,
    thumbCanvases,
    measurer,
    state,
    grid,
    grade,
    hoodLen,
    hoodBase,
    hoodNow,
    hoodDownScale,
    calibration,
    sized,
    placeSized,
    visible,
    thumbWork,
    setThumbWork,
    torso,
    anchorsBySide,
    elsewhere,
    field,
    fieldCm,
    fieldOutline,
    clips,
    selected,
    cropMenu,
    setCropMenu,
    cropRef,
    closeCropMenu,
    cropOpen,
    setCropOpen,
    nowKey,
    dirty,
    dirtyNow,
    rules,
    checked,
    findings,
  }
}
export type WindowState = ReturnType<typeof useWindowState>
