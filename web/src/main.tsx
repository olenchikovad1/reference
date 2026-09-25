import '@platform/tokens/tokens.css'
import { applyAppearance, readAppearance } from '@platform/shell'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'

// Вид платформы — до первой отрисовки, а не в эффекте: иначе вспышка светлой
// темы и прыжок раскладки при каждом входе.
applyAppearance(readAppearance())

const root = document.getElementById('root')
if (!root) throw new Error('Не найден узел #root — index.html разошёлся с точкой входа')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
