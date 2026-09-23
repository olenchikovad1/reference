import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'

const root = document.getElementById('root')
if (!root) throw new Error('Не найден узел #root — index.html разошёлся с точкой входа')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
