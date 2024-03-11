import 'server-only';
import HomeContainer from '../components/Home'
import Jamsocket, { JamsocketInitOptions } from '@jamsocket/server'

const IS_DEV = process.env.NODE_ENV === 'development'
const ACCOUNT_NAME = 'taylor'
const SERVICE_NAME = 'whiteboard-demo-deployed'
const WHITEBOARD_NAME = `${SERVICE_NAME}/default`
const JAMSOCKET_API_TOKEN = process.env.JAMSOCKET_API_TOKEN ?? ''

if (!IS_DEV && !JAMSOCKET_API_TOKEN) {
  throw new Error(`Expected JAMSOCKET_API_TOKEN in environment`)
}

console.log('Using the following config:', { IS_DEV, ACCOUNT_NAME, SERVICE_NAME })

const opts: JamsocketInitOptions = IS_DEV ? { dev: true } : {
  account: ACCOUNT_NAME,
  service: SERVICE_NAME,
  token: JAMSOCKET_API_TOKEN
}

const jamsocket = Jamsocket.init(opts)

export default async function Page() {
  const spawnResult = await jamsocket.spawn({ lock: WHITEBOARD_NAME })
  console.log('spawned backend', spawnResult)
  return <HomeContainer spawnResult={spawnResult} />
}
