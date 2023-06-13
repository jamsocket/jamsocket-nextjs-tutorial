export type SpawnResult = {
  url: string
  name: string
  readyUrl: string
  statusUrl: string
  spawned: boolean
  bearerToken?: string
}

const JAMSOCKET_API = 'https://api.jamsocket.com'

export async function spawnBackend(account: string, service: string, token: string, lock?: string, env?: Record<string, string>): Promise<SpawnResult> {
  const reqBody: { lock?: string, env?: Record<string, string> } = {}
  if (lock) reqBody.lock = lock
  if (env) reqBody.env = env
  const response = await fetch(`${JAMSOCKET_API}/user/${account}/service/${service}/spawn`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
    cache: 'no-store'
  })
  if (!response.ok) {
    throw new Error(`Error spawning backend: ${response.status} ${await response.text()}`)
  }
  const body = await response.json()
  console.log('spawn response:', body)
  return {
    url: body.url,
    name: body.name,
    readyUrl: body.ready_url,
    statusUrl: body.status_url,
    spawned: body.spawned,
    bearerToken: body.bearer_token
  }
}
