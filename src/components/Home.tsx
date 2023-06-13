"use client";

import { useState } from 'react'
import Header from './Header'
import Content from './Content'
import { Spinner, Whiteboard } from './Whiteboard'
import type { Shape } from './Whiteboard'

export default function HomeContainer() {
  return <Home />
}

function Home() {
  const ready = true // we'll replace this with a real check later
  const [shapes, setShapes] = useState<Shape[]>([])
  return (
    <main>
      <Header />
      <Content>
        {ready ? (
          <Whiteboard
            shapes={shapes}
            onCreateShape={(shape) => {
              setShapes([...shapes, shape])
            }}
            onUpdateShape={(id, shape) => {
              setShapes((shapes) => shapes.map((s) => s.id === id ? { ...s, ...shape } : s))
            }}
          />
        ) : <Spinner />}
      </Content>
    </main>
  )
}
