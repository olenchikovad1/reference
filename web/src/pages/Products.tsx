// Изделия деревом товарной иерархии (US-0489): направление › пол › группа ›
// категория, на ней модели с цветомоделями и дропами, где те выходят.
// Модель открывается карточкой (US-0718): кадры состояний, поля печати,
// размерная сетка, цветомодели — каждый блок с подписью, откуда он и зачем.

import { DataTable, EmptyState, Modal, PageHeader, type DataColumn } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { DropFilterBar } from '../candidates/DropFilter'
import { fetchCatalogue, type TreeNode } from '../shared/api/drops'
import { fetchProduct, frameUrl, type Product } from '../shared/api/products'
import { passes, useDropFilter, type DropFilter } from '../shared/filters'

type Model = TreeNode['models'][number]
type ColourRow = Model['colour_models'][number]
type FieldRow = { size: string; byField: Record<string, number[]> }

/** Дерево под фильтр: модели, прошедшие его, с ветками до них. Изделие в
 *  дроп попадает через ассортимент — цветомодель, которая в нём выходит. */
function pruned(nodes: TreeNode[], f: DropFilter, audience: string = 'all', category = ''): TreeNode[] {
  return nodes.flatMap((n) => {
    const aud = n.audience ?? audience
    const cat = n.level === 'category' ? n.name : category
    const models = n.models.filter((m) =>
      passes({ drops: m.colour_models.flatMap((cm) => cm.drop_ids), audiences: [aud], categories: cat ? [cat] : [] }, f),
    )
    const children = pruned(n.children, f, aud, cat)
    return models.length || children.length ? [{ ...n, models, children }] : []
  })
}

export function Products() {
  const tree = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue })
  const drop = useDropFilter()
  const [opened, setOpened] = useState<Model | null>(null)
  const shown = tree.data ? pruned(tree.data, drop.filter) : []
  return (
    <main className="p-4">
      <PageHeader
        title="Изделия"
        description="Модели по товарной иерархии. Нажмите модель — кадры, поля печати, размеры и цветомодели."
      />
      <DropFilterBar {...drop} />
      {tree.isPending ? (
        <p className="text-sm text-muted-foreground">Загружаю изделия…</p>
      ) : tree.isError ? (
        <EmptyState title="Справочник изделий не ответил" description="Обновите страницу; если повторится — стенд сервиса не поднят." />
      ) : tree.data.length === 0 ? (
        <EmptyState title="Изделий пока нет" description="Справочник заполняется руками (решение 0013)." />
      ) : shown.length === 0 ? (
        <EmptyState title="Под отбор не попало ни одного изделия" description="Сбросьте часть условий." />
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((n) => (
            <Node key={n.id} node={n} onOpen={setOpened} />
          ))}
        </ul>
      )}
      {opened && <ProductCard model={opened} onClose={() => setOpened(null)} />}
    </main>
  )
}

function Node({ node, onOpen }: { node: TreeNode; onOpen: (m: Model) => void }) {
  return (
    <li className="my-1">
      <span className={node.level === 'category' ? 'font-semibold' : 'text-muted-foreground'}>{node.name}</span>
      <ul className="m-0 list-none pl-5">
        {node.children.map((c) => (
          <Node key={c.id} node={c} onOpen={onOpen} />
        ))}
        {node.models.map((m) => (
          <li key={m.id} className="my-1.5">
            <button
              className="pf-card flex w-full max-w-3xl flex-wrap items-baseline gap-x-2 border border-line px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onOpen(m)}
              title="Открыть карточку изделия"
            >
              <b>{m.name}</b>
              <span className="text-xs text-muted-foreground">{m.code}</span>
              {!m.can_work && <span className="text-xs text-warning">· {m.reason} — что это значит, в карточке</span>}
              <span className="basis-full text-xs text-muted-foreground">
                {m.colour_models
                  .map((cm) => `${cm.colour_code}: ${cm.drops.length ? cm.drops.join(', ') : 'ни в одном дропе'}`)
                  .join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}

const COLOUR_COLUMNS: DataColumn<ColourRow>[] = [
  { id: 'colour', header: 'цвет', cell: (cm) => cm.colour_code },
  { id: 'drops', header: 'в дропах', sortable: false, cell: (cm) => (cm.drops.length ? cm.drops.join(', ') : 'ни в одном') },
  { id: 'refs', header: 'референсов', align: 'end', cell: (cm) => cm.references },
]

/** Карточка изделия (US-0718): всё, что о нём известно, и откуда. */
function ProductCard({ model, onClose }: { model: Model; onClose: () => void }) {
  const product = useQuery({
    queryKey: ['product', model.code],
    queryFn: () => fetchProduct(model.code),
    enabled: model.can_work,
    retry: false,
  })
  const refs = model.colour_models.reduce((a, cm) => a + cm.references, 0)
  return (
    <Modal open onClose={onClose} title={`${model.name} · ${model.code}`} size="wide">
      <div className="flex flex-col gap-4 text-sm">
        <Block
          title="Цветомодели и дропы"
          about="Модель в конкретном цвете — на ней рисуется референс; дроп — выпуск, в ассортименте которого она стоит. Ассортимент правится на странице «Дропы»."
        >
          <DataTable rows={model.colour_models} columns={COLOUR_COLUMNS} rowKey={(cm) => String(cm.id)} pagination="off" empty="Цветомоделей нет." />
          <p className="mt-1 text-xs text-muted-foreground">Всего референсов на модели: {refs}.</p>
        </Block>
        {!model.can_work ? (
          <Block title="Кадров нет" about="">
            <p>
              На этой модели нельзя начать референс: у изделия нет кадров — снимков изделия в положениях (перед, спина) с
              калибровкой «см ↔ пиксели». Без кадра не на чем примерять принт и нечем мерить поле печати.
            </p>
            <p className="mt-1 text-muted-foreground">
              Кадры готовит технолог: выгружает из VStitcher изделие в каждом положении на прозрачном фоне, обводит печатную зону
              и заводит описание изделия (решения 0001 и 0004). Пока их нет, модель видна в справочнике, дропах и ассортименте, но
              рисовать на ней нельзя.
            </p>
          </Block>
        ) : product.isPending ? (
          <p className="text-muted-foreground">Загружаю описание изделия…</p>
        ) : product.isError ? (
          <p className="text-destructive">Описание изделия не пришло: {(product.error as Error).message}</p>
        ) : (
          <Described product={product.data} />
        )}
      </div>
    </Modal>
  )
}

function Described({ product }: { product: Product }) {
  const fields = product.print_fields
  const fieldNames = fields ? [...new Set(Object.values(fields.by_size).flatMap((f) => Object.keys(f)))] : []
  const fieldRows: FieldRow[] = fields ? Object.entries(fields.by_size).map(([size, byField]) => ({ size, byField })) : []
  const fieldColumns: DataColumn<FieldRow>[] = [
    { id: 'size', header: 'размер', cell: (r) => r.size },
    ...fieldNames.map((f) => ({
      id: f,
      // Поле называется положением изделия: front — «Перед».
      header: product.states.find((st) => st.code === f)?.display_name ?? f,
      sortable: false,
      cell: (r: FieldRow) => (r.byField[f] ? r.byField[f].join(' × ') : '—'),
    })),
  ]
  const grid = product.size_grid
  return (
    <>
      <Block
        title="Кадры состояний"
        about="Изделие в одном положении. По точному ракурсу считаются размещение и проверки; иллюстративный — только показ. Калибровка — сколько пикселей кадра в сантиметре ткани."
      >
        <div className="flex flex-wrap gap-3">
          {product.states.map((st) => (
            <figure key={st.code} className="w-36">
              <img src={frameUrl(product.code, st.code)} alt={st.display_name} className="h-36 w-36 rounded bg-muted object-contain" />
              <figcaption className="mt-1 text-xs">
                <b>{st.display_name}</b>
                <div className="text-muted-foreground">{st.kind === 'precise' ? 'точный ракурс' : 'иллюстративный'}</div>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Калибровка: {product.calibration.px_per_cm} пикс/см
          {product.calibration.provisional && ' (предварительно)'}
          {product.calibration.note ? ` — ${product.calibration.note}` : ''}
          {product.states_absent.length > 0 && ` · положений ещё нет: ${product.states_absent.join(', ')}`}
        </p>
      </Block>
      <Block
        title="Поля печати по размерам, см"
        about="Ограничение: куда физически можно печатать на этом размере, ширина × высота. Не масштаб принта — выход за поле линтер референса называет ошибкой."
      >
        <DataTable rows={fieldRows} columns={fieldColumns} rowKey={(r) => r.size} pagination="off" empty="Полей печати в описании нет — проверки поля не работают." />
        {fields?.provisional && <p className="mt-1 text-xs text-muted-foreground">Числа предварительные.</p>}
      </Block>
      <Block
        title="Размерная сетка"
        about={`Во сколько раз изделие размера больше базового. Работа хранится в базовом размере${grid ? ` (${grid.base})` : ''}, выбранный размер — взгляд на неё: меняются числа и рамка поля.`}
      >
        <p className="text-xs">
          Ряд «{product.size_set.name}»: {product.size_set.sizes.join(', ')}
        </p>
        {grid && (
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {Object.entries(grid.by_size)
              .map(([s, k]) => `${s} — ×${k.toFixed(2)}`)
              .join(' · ')}
            {grid.provisional && ' (предварительно, по росту)'}
          </p>
        )}
      </Block>
    </>
  )
}

function Block({ title, about, children }: { title: string; about: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      {about && <p className="mb-1.5 text-xs text-muted-foreground">{about}</p>}
      {children}
    </section>
  )
}
