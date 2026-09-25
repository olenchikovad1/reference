// Изделия деревом товарной иерархии (US-0489): направление › пол › группа ›
// категория, на ней модели с цветомоделями и дропами, где те выходят.

import { useQuery } from '@tanstack/react-query'

import { fetchCatalogue, type TreeNode } from '../shared/api/drops'

export function Products() {
  const tree = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue })
  if (tree.isPending) return <main style={{ padding: 24 }}>Загружаю изделия…</main>
  if (tree.isError) return <main style={{ padding: 24 }}>Справочник изделий не ответил — обновите страницу.</main>
  if (tree.data.length === 0)
    return <main style={{ padding: 24 }}>Изделий пока нет — справочник заполняется руками (решение 0013).</main>
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>Изделия</h1>
      <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
        {tree.data.map((n) => (
          <Node key={n.id} node={n} />
        ))}
      </ul>
    </main>
  )
}

function Node({ node }: { node: TreeNode }) {
  return (
    <li style={{ margin: '4px 0' }}>
      <span style={{ fontWeight: node.level === 'category' ? 600 : 400 }}>{node.name}</span>
      <ul style={{ listStyle: 'none', paddingLeft: 18, margin: 0 }}>
        {node.children.map((c) => (
          <Node key={c.id} node={c} />
        ))}
        {node.models.map((m) => (
          <li key={m.id} style={{ margin: '6px 0', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6 }}>
            <b>{m.name}</b> <span style={{ color: '#666', fontSize: 12 }}>{m.code}</span>
            {!m.can_work && <span style={{ color: '#b45309', fontSize: 12 }}> · {m.reason}</span>}
            <ul style={{ listStyle: 'none', paddingLeft: 12, margin: '4px 0 0', fontSize: 13 }}>
              {m.colour_models.map((cm) => (
                <li key={cm.id}>
                  {cm.colour_code}: {cm.drops.length ? cm.drops.join(', ') : 'ни в одном дропе'}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </li>
  )
}
