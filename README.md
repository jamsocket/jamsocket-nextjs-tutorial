# jamsocket-nextjs-tutorial

This repo is a starter repo for the Jamsocket NextJS + Socket.io Tutorial. The tutorial walks through how to use Jamsocket and Socket.io to add multiplayer presence and state-sharing features to a NextJS whiteboard app.

To try out a completed version of the whiteboard from this tutorial, check out the `completed` branch, run `npm install` and `npm run dev`. Then run `npx jamsocket dev` in a separate terminal tab and visit `http://localhost:3000`.

# NextJS + Socket.io Tutorial

Session backends are great for document-editing apps, which often load the entire document into memory and apply changes to the in-memory document. (Here, a document may be a text document, spreadsheet, vector graphic, image, or video, etc). For these kinds of applications, the session backend acts as a stateful layer between your client and storage (i.e. a database or blob store). The session backend is a place to...

- quickly handle edits to the in-memory document
- persist changes to your storage of choice in the background

This makes it easier to support collaborative editing features and synchronize your document state between several users and a backing store. Using a session backend to update an in-memory document during the user session also lets you use inexpensive blob storage (like S3) when the document is not being edited. (Read more about session backends in [our blogpost about them](https://driftingin.space/posts/session-lived-application-backends).)

Let's see how this can work by building a whiteboard app with multiplayer editing and presence features. Here's a little preview of what we're building in this tutorial:

![jamsocket-nextjs-demo](assets/jamsocket-nextjs-demo.gif "jamsocket-nextjs-demo"){ width="750px" }

Note: we'll be using [Docker's command-line tool](https://www.docker.com/get-started) and [NodeJS](https://nodejs.org/en/), so get those installed if you haven't already.

## Setting up the starter repo

We've put together [a starter repo](https://github.com/jamsocket/jamsocket-nextjs-tutorial) for this tutorial that contains a NextJS app along with a few helper functions.

```bash
git clone https://github.com/jamsocket/jamsocket-nextjs-tutorial.git
cd jamsocket-nextjs-tutorial
```

In the project, you'll find a typical NextJS directory structure. We'll add code to the following three files:

- `src/app/page.tsx` - This is what gets rendered for the `/` path. For this tutorial, it'll be a React Server Component. We'll have it be responsible for starting up a session backend on Jamsocket.
- `src/components/Home.tsx` - This is the main client-side component for our app. It is rendered by the Server Component in `src/app/page.tsx` and will be responsible for the bulk of the app's functionality.
- `src/session-backend` - This directory contains the session backend logic. For this demo, the session backend will just be running a [Socket.IO](https://socket.io) server that holds the state of the document in memory and receives/pushes document updates to/from the users who are currently editing it.

This repo also includes some helper components to kickstart our multiplayer demo:

- `src/components/Whiteboard.tsx` - This is a simple little whiteboard component that encapsulates the canvas and all the logic for creating and updating shapes from user interactions and for drawing other users' cursors to the screen.
- `src/components/Content.tsx`, `src/components/Header.tsx` - Some helper components for the styled elements of the demo.

Once you've cloned the repo, run:

```bash
npm install
npm run dev
```

Then you should be able to open the app in your browser on localhost with the port shown in the command output (probably `http://localhost:3000`).

If everything works, you'll notice you can create shapes by clicking and dragging on the page. You can move existing shapes by dragging them.

At this point, you're probably wondering if "whiteboard" isn't overselling it a bit. And you would be right. Implementing a full whiteboard application will be an exercise left to the reader, but, for now, this very limited whiteboard should serve us well as a demo for implementing state sharing and presence features with session backends.

Speaking of state-sharing and presence features - you'll notice that opening the app in another tab gives you a completely blank canvas. Let's see if we can't get this app to share the state of the whiteboard with other tabs.

## Writing our session backend

Let's start by adding presence to our application. When another user enters the document, we want to see their cursor on the canvas and their avatar up in corner of the screen.

Since the session backend will be our source of truth for the document state, let's start there.

In `src/session-backend/index.ts` we're already importing `socket.io`, starting a WebSocket server on port 8080, and listening for new connections. Let's add some code that keeps track of which users are currently connected and emit an event to all the clients when a user connects or disconnects.

```ts filename="src/session-backend/index.ts" {1, 5-22}
const users: Set<{ id: string; socket: Socket }> = new Set()
io.on('connection', (socket: Socket) => {
  console.log('New user connected:', socket.id)

  // store each user's socket connection and user id (socket.id will be the stand in for user id)
  const newUser = { id: socket.id, socket }
  users.add(newUser)

  // send all existing users a 'user-entered' event for the new user
  socket.broadcast.emit('user-entered', newUser.id)

  // send the new user a 'user-entered' event for each existing user
  for (const user of users) {
    newUser.socket.emit('user-entered', user.id)
  }

  // when a user disconnects, delete the user from our set
  // and broadcast a 'user-exited' event to all the other users
  socket.on('disconnect', () => {
    users.delete(newUser)
    socket.broadcast.emit('user-exited', newUser.id)
  })
})
```

Now that we've got a simple backend written, it's time to shift our focus to the application code for our NextJS project.

We need to do two things:

1. get our server component to spawn a new backend when someone opens the whiteboard, and
2. update our client-side logic to connect to the session backend and listen for our `user-entered` and `user-exited` WebSocket events.

## Spawning our session backend

In our Page component, let's import `@jamsocket/server`. It contains helper functions that we can use to spawn a session backend. It's important that we spawn from server code as eventually we'll be using an API token here that we want to keep secret, so let's use our React Server Component (`src/app/page.tsx`). (If you aren't using React Server Components, this could just as easily be done in an API route.)

```ts filename="src/app/page.tsx"
import 'server-only'
import { Jamsocket } from '@jamsocket/server'

const jamsocket = new Jamsocket({ dev: true })
```

When developing locally with the Jamsocket Dev CLI, we can just pass `{ dev: true }` to the `Jamsocket` constructor. We'll replace this with account and service names and an API token when it comes time to deploy this to Jamsocket. You can see an example in [in the `@jamsocket/server` docs](/client-libraries/js-server).

The returned `jamsocket` instance has a `connect()` method that we'll use to get a connection URL for connecting to the our session backend from a browser. It takes a single, optional `connectRequest` argument. The `connectRequest` object allows us to configure a lot of aspects of how the session backend runs. (Our docs have more information about [connect() options for the HTTP API](https://docs.jamsocket.com/platform/reference/rest-api/v2#get-a-connection-url-for-a-backend).) For now, we will only use one of those options: `key`. You can learn more about keys [here](https://docs.jamsocket.com/platform/advanced/keys), but for now it suffices to say that we'll just use a document name. And for this demo, we'll just have one document that everybody edits called `whiteboard-123`.

The result of the `jamsocket.connect()` function contains a [Connection URL](/concepts/connection-url) that you can use to connect to the session backend, a status URL which returns the current status of the session backend, and some other values like the backend's ID.

Note that `Page` is rendered in a server-side component. This ensures that your secrets aren't leaked to the client. Once we receive the spawn result, the `Page` component will pass that information to the `HomeContainer` component.

```ts filename="src/app/page.tsx" {4, 9, 10}
import 'server-only'
import { Jamsocket } from '@jamsocket/server'

const WHITEBOARD_NAME = 'whiteboard-123'

const jamsocket = new Jamsocket({ dev: true })

export default async function Page() {
  const connectResponse = await jamsocket.connect({ key: WHITEBOARD_NAME })
  return <HomeContainer connectResponse={connectResponse} />
}
```

<Callout type="warning" emoji="⚠️">
  At this point, the typechecker will have some complaints. Let's fix those in the next section
</Callout>

## Connecting to our session backend

To connect to our session backend, the `HomeContainer` component should accept `connectResponse` as props and pass that into the `SessionBackendProvider`. The `SessionBackendProvider` lets us use Jamsocket's React hooks to interact with the session backend.

You will also need the `SocketIOProvider` to connect to the SocketIO server running in your session backend. The `SocketIOProvider` uses the [connection url](/concepts/connection-url) from `connectResponse.url` to connect to the SocketIO server. The `SocketIOProvider` also lets us use Socket.io-specific React hooks in `@jamsocket/socketio` to send and listen to events. Because `@jamsocket/socketio` re-exports `@jamsocket/react`'s exports, we can import everything we need from `@jamsocket/socketio`.

```ts filename="src/components/Home.tsx"
import { SessionBackendProvider, SocketIOProvider } from '@jamsocket/socketio'
import type { ConnectResponse } from '@jamsocket/socketio'

export default function HomeContainer({ connectResponse }: { connectResponse: ConnectResponse }) {
  return (
    <SessionBackendProvider connectResponse={connectResponse}>
      <SocketIOProvider url={connectResponse.url}>
        <Home />
      </SocketIOProvider>
    </SessionBackendProvider>
  )
}
```
Next, let's keep track of which users are in the document with some component state. And we can pass that list of users to our `AvatarList` component which will render an avatar in the header for each user who is currently in the document.

```ts filename="src/components/Home.tsx" {1-2, 9, 12-14}
import type { Shape, User } from '../types'
import { AvatarList } from './Whiteboard'

// ...

function Home() {
  const ready = true // we'll replace this with a real check later
  const [shapes, setShapes] = useState<Shape[]>([])
  const [users, setUsers] = useState<User[]>([])
  return (
    <main>
      <Header>
        <AvatarList users={users} />
      </Header>
      <Content>
      // ...
  )
}
```

Now, in our `Home` component, we can use the `useEventListener` hook to listen for our `user-entered` and `user-exited` events we're sending from our session backend.

```ts filename="src/components/Home.tsx" {1}
import { SessionBackendProvider, SocketIOProvider, useEventListener } from '@jamsocket/socketio'
import type { ConnectResponse } from '@jamsocket/socketio'
```

Then we can subscribe to the events with our hook. On the `user-entered` event, we should create a user object with an `id` and a `cursorX` and `cursorY` property (we'll use these when we implement cursor presence). And on the `user-exited` event, let's just remove the user from the list of users in our component state.

```ts filename="src/components/Home.tsx" {6-13}
function Home() {
  const ready = true // we'll replace this with a real check later
  const [shapes, setShapes] = useState<Shape[]>([])
  const [users, setUsers] = useState<User[]>([])

  useEventListener<string>('user-entered', (id) => {
    const newUser = { cursorX: null, cursorY: null, id }
    setUsers((users) => [...users, newUser])
  })

  useEventListener<string>('user-exited', (id) => {
    setUsers((users) => users.filter((p) => p.id !== id))
  })

  // ...
}
```

Let's also import the `useReady` hook that we can use to show a spinner while the session backend is starting up. Depending on your application, it may or may not make sense to show a spinner, but for this demo we'll take the simpler approach of ensuring the session backend is running and the inital document state is loaded before the user can start editing it.

```ts filename="src/components/Home.tsx" {1, 7}
import { SessionBackendProvider, SocketIOProvider, useEventListener, useReady } from '@jamsocket/socketio'
import type { ConnectResponse } from '@jamsocket/socketio'

// ...

function Home() {
  const ready = useReady()
  const [shapes, setShapes] = useState<Shape[]>([])
  // ...
}
```

Finally - the moment of truth. Let's start the Jamsocket Dev CLI to see if everything works! In another terminal window:

```bash copy
npx jamsocket dev
```

The dev CLI does several things to make development easier, the first of which is automatically rebuilding our session backend Docker image when the code changes. When you run `npx jamsocket dev`, the first thing it does is build your session backend code and start a local server that emulates Jamsocket's API.

Let's take a quick look at the `jamsocket.config.json` file in the project root to see how all this works:

```json filename="jamsocket.config.json"
{
  "dockerfile": "./src/session-backend/Dockerfile",
  "watch": ["./src/session-backend"],
  "dockerOptions": {
    "path": "."
  }
}
```

This config file is used by the dev CLI so it knows (1) how to build the session backend into a Docker image and (2) which parts of the file system to watch for changes.

So in our demo, the dev CLI will watch the `src/session-backend` directory, and when a change is detected, it will rebuild the image using the given Dockerfile and the current working directory as the Docker build context. Then, when we refresh the page, the `jamsocket.connect()` function will send a request to the dev server which will spawn a new backend using the Docker container that was just built and return a connection URL for the backend.

The second thing the dev CLI does for us is keep track of session backends we've spawned during development, terminating backends that are running old code, and streaming status updates and logs from your session backend.

Now with both Jamsocket dev CLI and `npm run dev` running in separate terminal windows, you should be able to refresh the page and see an avatar in the header. And if you open the app in another window, another avatar should appear.

If you take a look at the terminal window running the dev CLI, you should see that our server component spawned a backend and now its statuses and logs are appearing in the dev CLI output.

## Implementing cursor presence

Most of the hard work is behind us, so let's add a few more events. Let's keep track of the cursor position for each user so we can display that on top of the whiteboard.

We'll start by subscribing to a `cursor-position` event and updating our list of users with the user passed to it:

```ts filename="src/components/Home.tsx" {6-8}
function Home() {
  const ready = useReady()
  const [shapes, setShapes] = useState<Shape[]>([])
  const [users, setUsers] = useState<User[]>([])

  useEventListener<User>('cursor-position', (user) => {
    setUsers((users) => users.map((p) => p.id === user.id ? user : p))
  })

// ...
}
```

Then we need to send a `cursor-position` event to the session backend as our cursor moves over the whiteboard.

We can do this by importing the `useSend` hook and then creating a `sendEvent` function with it:

```ts filename="src/components/Home.tsx" {1, 6}
import { SessionBackendProvider, SocketIOProvider, useEventListener, useReady, useSend } from '@jamsocket/socketio'
import type { ConnectResponse } from '@jamsocket/socketio'

function Home() {
  const ready = useReady()
  const sendEvent = useSend()
  const [shapes, setShapes] = useState<Shape[]>([])
  const [users, setUsers] = useState<User[]>([])
  // ...
}
```

Then, we can pass a `users` prop and an `onCursorMove` prop to our `<Whiteboard>` component, that takes the cursor's position and sends it to our session backend.

```ts filename="src/components/Home.tsx" {3-6}
<Whiteboard
  shapes={shapes}
  users={users}
  onCursorMove={(position) => {
    sendEvent('cursor-position', { x: position?.x, y: position?.y })
  }}
/>
```

Now we just need to add a `cursor-position` event to our session backend code. In our `src/session-backend/index.ts` file let's subscribe to the `cursor-position` event and emit a `cursor-position` event to all connected clients. We can use `volatile.broadcast` here because it's okay if we drop a couple `cursor-position` events here and there. For cursor positions, we really just care about the most recent cursor position message.

```ts filename="src/session-backend/index.ts" {3-5}
io.on('connection', (socket: Socket) => {
  console.log('New user connected:', socket.id)
  socket.on('cursor-position', ({ x, y }) => {
    socket.volatile.broadcast.emit('cursor-position', { id: socket.id, cursorX: x, cursorY: y })
  })
  // ...
})
```

Okay, with that, let's take a look at our dev CLI. If it's still running, it should have rebuilt and pushed our session backend code to Jamsocket. It should have also terminated any previous backends running with out of date code.

Now, if we open the application in a new browser window, we should see a new session backend spawning in the dev CLI. If everything works, moving your cursor over one canvas should show a moving cursor on the other client. However, the shapes you create in one window don't appear in the other. Let's fix that in the next section by implementing state sharing across clients.

## Implementing shared state

The last thing we want to do in this demo is implement state-sharing. Right now, when you refresh the page, you lose all the shapes you've drawn. And when another connected client draws shapes, you can't see them. Let's fix that.

This time, we'll start with our session backend code. Let's create an array to store all the shapes. When a new user connects, we'll send them a snapshot of all the shapes. Let's also listen for two new events: `create-shape` and `update-shape`, which will update our list of shapes accordingly.

```ts filename="src/session-backend/index.ts" {1, 5, 8, 14-27}
import type { Shape } from '../types'

// ...

const shapes: Shape[] = []
io.on('connection', (socket: Socket) => {
  console.log('New user connected:', socket.id)
  socket.emit('snapshot', shapes)

  socket.on('cursor-position', ({ x, y }) => {
    socket.volatile.broadcast.emit('cursor-position', { id: socket.id, cursorX: x, cursorY: y })
  })

  socket.on('create-shape', (shape: Shape) => {
    shapes.push(shape)
    socket.broadcast.emit('snapshot', shapes)
  })

  socket.on('update-shape', (updatedShape: Shape) => {
    const shape = shapes.find(s => s.id === updatedShape.id)
    if (!shape) return
    shape.x = updatedShape.x
    shape.y = updatedShape.y
    shape.w = updatedShape.w
    shape.h = updatedShape.h
    socket.broadcast.emit('update-shape', shape)
  })
})
```

Now, let's add our `sendEvent()` and `useEventListener()` calls to the `Home` component.

First, we should listen for our new `snapshot` and `update-shape` events:

```ts filename="src/components/Home.tsx" {6-16}
function Home() {
  const ready = useReady()
  const [shapes, setShapes] = useState<Shape[]>([])
  const [users, setUsers] = useState<User[]>([])

  useEventListener<Shape[]>('snapshot', (shapes) => {
    setShapes(shapes)
  })

  useEventListener<Shape>('update-shape', (shape) => {
    setShapes((shapes) => {
      const shapeToUpdate = shapes.find((s) => s.id === shape.id)
      if (!shapeToUpdate) return [...shapes, shape]
      return shapes.map((s) => s.id === shape.id ? { ...s, ...shape } : s)
    })
  })
  // ...
}
```

Then in our `onCreateShape` and `onUpdateShape` Whiteboard props, we should send the appropriate event to the session backend:

```ts filename="src/components/Home.tsx" {8, 12}
<Whiteboard
  shapes={shapes}
  users={users}
  onCursorMove={(position) => {
    sendEvent('cursor-position', { x: position?.x, y: position?.y })
  }}
  onCreateShape={(shape) => {
    sendEvent('create-shape', shape)
    setShapes([...shapes, shape])
  }}
  onUpdateShape={(id, shape) => {
    sendEvent('update-shape', { id, ...shape })
    setShapes((shapes) => shapes.map((s) => s.id === id ? { ...s, ...shape } : s))
  }}
/>
```

Now, the dev CLI should have rebuilt the session backend docker image and removed old session backends we had spawned with the previous version of the code. We should be able to simply open the app in a few browser windows and see:

* an avatar for each user
* each user's cursor as it hovers over the whiteboard
* all the same shapes as they are created and moved around the screen

## Deploying your session backend code to Jamsocket

The last thing you might want to do is actually run your session backends on Jamsocket. To do that, you'll need to:

1. Create a Jamsocket account by going to [app.jamsocket.com](https://app.jamsocket.com).
2. Log in to the Jamsocket CLI and create a service, let's call it `whiteboard-demo`:

```bash
npx jamsocket login
npx jamsocket service create whiteboard-demo
```

3. Build and push your session backend to Jamsocket:

```bash copy
npx jamsocket push whiteboard-demo -f src/session-backend/Dockerfile
```

4. Create an API token on [the Jamsocket settings page](https://app.jamsocket.com/settings).
5. Change the `new Jamsocket()` call in `src/app/page.tsx` by passing in `account`, `service`, and `token`:

```ts filename="src/app/page.tsx"
const jamsocket = new Jamsocket({
  account: '[YOUR ACCOUNT NAME]', // if you are unsure, you can find this at https://app.jamsocket.com/settings
  service: 'whiteboard-demo',
  token: '[YOUR API TOKEN]', // this is the token you just created in step 5
})
```

Now, when you run your NextJS app locally, it'll spawn your session backend on Jamsocket. You can see which session backends have been spawned by visiting your new `whiteboard-demo` service in [the Jamsocket Dashboard](https://app.jamsocket.com) or by running:

```bash
npx jamsocket backend list
```

## What's next?
  - Learn about [how to persist your document state](https://docs.jamsocket.com/platform/advanced/persistence) when a session backend stops.

If you have any questions about how to use Jamsocket or would like to talk through your particular use case, we'd love to chat! Send us an email at [hi@jamsocket.com](mailto:hi@jamsocket.com)!
