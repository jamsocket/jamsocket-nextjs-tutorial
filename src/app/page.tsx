import 'server-only';
import HomeContainer from '../components/Home'
import { Jamsocket } from '@jamsocket/server'

const WHITEBOARD_NAME = 'whiteboard-123'

const jamsocket = new Jamsocket({ dev: true })

// In production, you'll want to do the following instead:
// const spawnBackend = new Jamsocket({
//   account: '[YOUR ACCOUNT HERE]',
//   service: 'whiteboard-demo',
//   // NOTE: we want to keep the Jamsocket token secret, so we can only do this in a server component
//   token: '[YOUR TOKEN HERE]',
// })

export default async function Page() {
  const connectResponse = await jamsocket.connect({ key: WHITEBOARD_NAME })
  return <HomeContainer connectResponse={connectResponse} />
}
