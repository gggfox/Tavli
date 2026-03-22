import { useEffect, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'

function getNames() {
  return fetch('/demo/api/names').then((res) => res.json() as Promise<string[]>)
}

export const Route = createFileRoute('/demo/start/api-request')({
  component: Home,
})

function Home() {
  const [names, setNames] = useState<Array<string>>([])

  useEffect(() => {
    getNames().then(setNames)
  }, [])

  return (
    <div
      className="flex items-center justify-center h-full p-4 text-white overflow-hidden"
      style={{
        backgroundColor: '#000',
        backgroundImage:
          'radial-gradient(ellipse 60% 60% at 0% 100%, #444 0%, #222 60%, #000 100%)',
      }}
    >
      <div className="w-full max-w-2xl max-h-full p-8 rounded-xl backdrop-blur-md bg-black/50 shadow-xl border-8 border-black/10 flex flex-col overflow-hidden">
        <h1 className="text-2xl mb-4 shrink-0">Start API Request Demo - Names List</h1>
        <ul className="mb-4 space-y-2 overflow-y-auto flex-1">
          {names.map((name) => (
            <li
              key={name}
              className="bg-white/10 border border-white/20 rounded-lg p-3 backdrop-blur-sm shadow-md"
            >
              <span className="text-lg text-white">{name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
