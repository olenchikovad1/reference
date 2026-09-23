import { useEffect, useState } from 'react'

// Временный экран базового стенда. Он существует ровно затем, чтобы было видно:
// фронтенд поднялся и достучался до сервиса по тому же префиксу, что и в
// платформе. Оболочка @platform/shell придёт, когда станет доступен её реестр
// (решение 0006), и этот файл будет заменён целиком.

type Health = { status: string; database?: string }

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/reference/api/health/ready')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setHealth)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Референс</h1>
      <p>Базовый стенд. Пакеты платформы ещё не подключены.</p>
      {error && <p>Сервис не отвечает: {error}</p>}
      {health && <p>Сервис: {health.status}, база: {health.database}</p>}
      {!health && !error && <p>Проверяю сервис…</p>}
    </main>
  )
}
