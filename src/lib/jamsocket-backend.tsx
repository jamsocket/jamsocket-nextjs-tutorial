"use client";

import { createContext, useContext, useEffect, useState } from 'react'
import { io, Socket, ManagerOptions, SocketOptions } from 'socket.io-client'
import { SpawnResult } from './jamsocket'

export type SocketOpts = Partial<ManagerOptions & SocketOptions>
export type Event = {
  event: string,
  args: string // these are stringified args - to freeze them in place
}
export type EventHandler = (...args: any[]) => void
export type Status = string
export type Listener = { event: string, cb: EventHandler }
export type StatusStreamEvent = { state: Status, time: string }

export class JamsocketBackend {
  private streamReader: ReadableStreamDefaultReader | null = null
  readonly statuses: Status[] = []
  private _isReady: boolean = false
  private _onReady: (() => void)[] = []
  private socket: Socket | null = null
  private listeners: Listener[] = []
  private events: Event[] = []

  constructor(readonly url: string, readonly statusUrl: string, readonly socketOpts?: SocketOpts) {
    console.log('Jamsocket backend:', url)
    this.waitUntilReady(statusUrl)
  }

  private waitUntilReady = async (statusUrl: string) => {
    const res = await fetch(statusUrl, { mode: 'cors', cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`An error occured while fetching jamsocket backend status: ${await res.text()}`)
    }
    const status = await res.text()
    if (status.includes('Ready')) {
      this.openSocket()
      return
    }
    if (!status.includes('Loading') && !status.includes('Starting')) {
      throw new Error(`Jamsocket status is a Terminal state: ${status}`)
    }

    const response = await fetch(`${statusUrl}/stream`, { cache: 'no-store' })
    if (!response.body) throw new Error('response to Jamsocket backend status stream did not include body')
    this.streamReader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    while (this.streamReader !== null) {
      const result = await this.streamReader.read()
      const value = result.value as string
      if (result.done) {
        console.log('Jamsocket status stream closed by API')
        this.destroyStatusStream()
        break
      }

      const messages = value.split('\n').map(v => v.trim()).filter(Boolean)

      for (const msg of messages) {
        if (!msg?.startsWith('data:')) throw new Error(`Unexpected message from SSE endpoint: ${msg}`)
        const text = msg.slice(5).trim()
        let data: StatusStreamEvent | null = null
        try {
          data = JSON.parse(text) as StatusStreamEvent
        } catch (e) {
          console.error(`Error parsing status stream message as JSON: "${text}"`, e)
        }
        if (data?.state === 'Ready') {
          this.openSocket()
          this.destroyStatusStream()
        }
      }
    }
  }

  private destroyStatusStream = () => {
    if (this.streamReader) {
      this.streamReader.cancel()
      this.streamReader = null
    }
  }

  public destroy() {
    this.destroyStatusStream()
    this.socket?.disconnect()
  }

  public isReady() {
    return this._isReady
  }

  public onReady(cb: () => void): () => void {
    if (this.isReady()) {
      cb()
    } else {
      this._onReady.push(cb)
    }
    return () => {
      if (this.isReady()) return
      this._onReady = this._onReady.filter(c => c !== cb)
    }
  }

  public on(event: string, cb: EventHandler) {
    if (this.isReady()) {
      this.socket?.on(event, cb)
    } else {
      this.listeners.push({ event, cb })
    }
  }

  public off(event: string, cb: EventHandler) {
    if (this.isReady()) {
      this.socket?.off(event, cb)
    } else {
      const idx = this.listeners.findIndex(listener => listener.event === event && listener.cb === cb)
      if (idx) this.listeners.splice(idx, 1)
    }
  }

  public send(event: string, ...args: any[]) {
    if (this.isReady()) {
      this.socket?.emit(event, ...args)
    } else {
      this.events.push({ event, args: JSON.stringify(args) })
    }
  }

  private openSocket() {
    this.socket = io(this.url, this.socketOpts)
    this.socket.on('connect', () => {
      this._isReady = true
      this._onReady.forEach(cb => cb())
      this._onReady = []

      while (this.listeners.length > 0) {
        const { event, cb } = this.listeners.shift()!
        this.on(event, cb)
      }
      while (this.events.length > 0) {
        const { event, args } = this.events.shift()!
        this.send(event, ...JSON.parse(args))
      }
    })
  }
}

export const JamsocketBackendContext = createContext<JamsocketBackend | null>(null)

export function JamsocketBackendProvider({ spawnResult, children }: { spawnResult: SpawnResult, children: React.ReactNode }) {
  const { url, statusUrl } = spawnResult
  const [backend, setBackend] = useState<JamsocketBackend | null>(null)

  useEffect(() => {
    setBackend(new JamsocketBackend(url, statusUrl))
    return () => {
      console.log('destroying backend')
      backend?.destroy()
    }
  }, [url, statusUrl])
  return (
    <JamsocketBackendContext.Provider value={backend}>
      {backend ? children : null}
    </JamsocketBackendContext.Provider>
  )
}

export function useReady(): boolean {
  const backend = useContext(JamsocketBackendContext)
  if (!backend) throw new Error('useReady must be used within a JamsocketBackendContext / Provider')
  const [isReady, setIsReady] = useState(backend.isReady())

  useEffect(() => {
    return backend.onReady(() => setIsReady(true))
  }, [backend])

  return isReady
}

export function useSend<T>(): (event: string, msg: T) => void {
  const backend = useContext(JamsocketBackendContext)
  if (!backend) throw new Error('useEventListener must be used within a JamsocketBackendContext / Provider')
  return (event, msg) => backend.send(event, msg)
}

export function useEventListener<T>(event: string, cb: (msg: T) => void) {
  const backend = useContext(JamsocketBackendContext)
  if (!backend) throw new Error('useEventListener must be used within a JamsocketBackendContext / Provider')

  useEffect(() => {
    if (!cb) return
    backend.on(event, cb)
    return () => backend.off(event, cb)
  }, [backend, event, cb])
}

// another option

// export function useEvent<T>(event: string, cb?: (msg: T) => void): (msg: T) => void {
//   const backend = useContext(JamsocketBackendContext)
//   if (!backend) throw new Error('useEventListener must be used within a JamsocketBackendContext / Provider')

//   useEffect(() => {
//     if (!cb) return
//     backend.on(event, cb)
//     return () => backend.off(event, cb)
//   }, [backend, event, cb])

//   return (msg) => backend.send(event, msg)
// }
