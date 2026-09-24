// Градация по размерам: размерная сетка изделия и принт на выбранном размере.
//
// Сетка — ОТДЕЛЬНАЯ таблица, а не поля печати (запрет №8): поле — это
// ограничение, «сколько можно печатать на размере»; сетка — преобразование,
// «во сколько раз этот размер больше базового». Сведённые в одну, они путают
// «нельзя» с «так положено», и принт подгоняют под поле, а не под изделие.
//
// Работа хранится В БАЗОВОМ размере — том, на котором отрисован кадр. Размер —
// взгляд на неё: сантиметры на 98 считаются из базы, а правка на 98
// переводится обратно в базу. Иначе переключение размера тихо переписывало бы
// то, от чего считаются все остальные.

import type { Composition, Placement } from './composition'

export interface SizeGrid {
  readonly provisional: boolean
  /** Базовый размер: на нём коэффициент — единица, в нём хранится работа. */
  readonly base: number
  readonly method: string
  /** Размер → во сколько раз изделие больше базового. */
  readonly by_size: Readonly<Record<string, number>>
}

/**
 * Во сколько раз изделие этого размера больше базового.
 *
 * Нет размера, нет сетки или размера нет в сетке — единица. Выдумать
 * коэффициент для размера, которого в сетке нет, значит отправить на фабрику
 * принт неизвестно какого размера.
 */
export function gradeOf(grid: SizeGrid | null | undefined, size: number | null): number {
  if (!grid || size === null) return 1
  return grid.by_size[String(size)] ?? 1
}

/** Размещение на размере: положение и ширина — по сетке. */
function onSize(p: Placement, g: number): Placement {
  if (g === 1) return p
  // Положение идёт за изделием: 12 см от горловины на 134 — это 8.8 на 98.
  // Иначе принт, стоящий на груди на базовом, на маленьком уехал бы на живот.
  return { ...p, dxCm: p.dxCm * g, dyCm: p.dyCm * g, widthCm: p.widthCm * g }
}

/** Композиция на выбранном размере. Исходная не меняется. */
export function graded(c: Composition, grid: SizeGrid | null | undefined, size: number | null): Composition {
  const g = gradeOf(grid, size)
  if (g === 1) return c
  return { ...c, elements: c.elements.map((el) => ({ ...el, placement: onSize(el.placement, g) })) }
}

/** Правка, сделанная на размере, — в единицах базы. */
export function toBase(
  patch: Partial<Placement>,
  grid: SizeGrid | null | undefined,
  size: number | null,
): Partial<Placement> {
  const g = gradeOf(grid, size)
  if (g === 1) return patch
  const out: { -readonly [K in keyof Placement]?: Placement[K] } = { ...patch }
  if (patch.dxCm !== undefined) out.dxCm = patch.dxCm / g
  if (patch.dyCm !== undefined) out.dyCm = patch.dyCm / g
  if (patch.widthCm !== undefined) out.widthCm = patch.widthCm / g
  return out
}
