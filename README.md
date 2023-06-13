# jamsocket-nextjs-tutorial

This repo is a starter repo for the Jamsocket NextJS Tutorial. The tutorial walks through how to add multiplayer presence and state-sharing features to a NextJS whiteboard app.

To try out a completed version of the whiteboard from this tutorial, check out the `completed` branch. Then, be sure to fill in the missing account and token values in `src/app/page.tsx`. (You can get a free account and API token at [app.jamsocket.com](https://app.jamsocket.com/settings).)

# NextJS Tutorial

Session backends are great for document-editing apps, which often load the entire document into memory and apply changes to the in-memory document. (Here, a document may be a text document, spreadsheet, vector graphic, image, or video, etc). For these kinds of applications, the session backend acts as a stateful layer between your client and storage (i.e. a database or blob store). The session backend is a place to...

- quickly handle edits to the in-memory document
- persist changes to your storage of choice in the background

This makes it easier to support collaborative editing features and synchronize your document state between several users and a backing store. Using a session backend to update an in-memory document during the user session also lets you use inexpensive blob storage (like S3) when the document is not being edited. (Read more about session backends in [our blogpost about them](https://driftingin.space/posts/session-lived-application-backends).)

Let's see how this can work by building a whiteboard app with multiplayer editing and presence features.

Note: we'll be using [Docker's command-line tool](https://www.docker.com/get-started) and [NodeJS](https://nodejs.org/en/), so get those installed if you haven't already. You'll also want to get a free Jamsocket API token. You can log in or create an account at [app.jamsocket.com](https://app.jamsocket.com), and create an API token on [the Settings page](https://app.jamsocket.com/settings).

## Setting up the starter repo

We've put together a starter repo for this tutorial that contains a NextJS app along with a few helper functions.

```
git clone https://github.com/drifting-in-space/jamsocket-nextjs-tutorial.git
cd jamsocket-nextjs-tutorial
```

In the project, you'll find a typical NextJS directory structure. We'll add code to the following three files:

- `src/app/page.tsx` - This is what gets rendered for the `/` path. For this tutorial, it'll be a React Server Component. We'll have it be responsible for starting up a session backend on Jamsocket.
- `src/components/Home.tsx` - This is the main clientside component for our app. It is rendered by the Server Component in `src/app/page.tsx` and will be responsible for the bulk of the app's functionality.
- `src/session-backend` - This directory contains the session backend logic. For this demo, the session backend will just be running a [SocketIO](https://socket.io) server that holds the state of the document in memory and receives/pushes document updates to/from the users who are currently editing it.

This repo also includes some helper functions and components to kickstart our multiplayer demo:

- `src/components/Whiteboard.tsx` - This is a simple little whiteboard component that encapsulates the canvas and all the logic for creating and updating shapes from user interactions and for drawing other users' cursors to the screen.
- `src/components/Content.tsx`, `src/components/Header.tsx` - Some helper components for the styled elements of the demo.
- `src/lib/jamsocket.ts` - This contains a helper function for spawning session backends on Jamsocket.
- `src/lib/jamsocket-backend.tsx` - This helper lib exports some hooks and a SessionBackendProvider that we'll use to interact with our session backend.

Once you've cloned the repo, run:

```
npm install
npm run dev
```

Then you should be able to open the app in your browser on localhost with the port shown in the command output (probably http://localhost:3000).

If everything works, you'll notice you can create shapes by clicking and dragging on the page. You can move existing shapes by dragging them. 

At this point, you're probably wondering if "whiteboard" isn't overselling it a bit. And you would be right. Implementing a full whiteboard application will be an exercise left to the reader, but, for now, this very limited whiteboard should serve us well as a demo for implementing state sharing and presence features with session backends.

Speaking of state-sharing and presence features - you'll notice that opening the app in another tab gives you a completely blank canvas. Let's see if we can't get this app to share the state of the whiteboard with other tabs.

## Writing our session backend

Let's start by adding presence to our application. When another user enters the document, we want to see their cursor on the canvas and their avatar up in corner of the screen.

Since the session backend will be our source of truth for the document state, let's start there.

In `src/session-backend/index.ts` we're already importing `socket.io`, starting a WebSocket server on port 8080, and listening for new connections. Let's add some code that keeps track of which users are currently connected and emit an event to all the clients when a user connects or disconnects.

```ts title="src/session-backend/index.ts" hl_lines="1 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22"
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

We need to do two things: (1) get our server component to spawn a new backend when someone opens the whiteboard, and (2) update our clientside logic to connect to the session backend and listen for our `user-entered` and `user-exited` WebSocket events.

## Create a Jamsocket service

Before we set up our server component, we'll need to get a few things set up to spawn backends.

Let's log in to the Jamsocket CLI and create a new service for our whiteboard demo called, well, `whiteboard-demo`.

```
npx jamsocket@latest login
npx jamsocket@latest service create whiteboard-demo
```

Also, if you haven't generated an API token yet, now is a good time to do that [here on the Settings page](https://app.jamsocket.com/settings).

## Spawning our session backend

In our Page component, let's import a helper function from our library that we can use to spawn a backend.

The `spawnBackend()` function takes four arguments:

* an account name - that's the account name you created when you signed up for Jamsocket (which you can find on [the Settings page](https://app.jamsocket.com/settings) in case you forgot)
* a service name - that's the name of the service we just created - `whiteboard-demo`
* an api token - that's the token you created earlier (you can create another one [here](https://app.jamsocket.com/settings) if you need to)
* a document name - for this demo, we'll just have one document that everybody edits called `whiteboard-demo/default` (this string is used as a lock - you can learn more about spawning with locks [here](/locking-a-backend-to-a-resource))

The result of the `spawnBackend()` function contains a URL that you can use to connect to the session backend, a status URL which returns the current status of the session backend, and some other values like the backend's name and an optional bearer token which is useful when authenticating client requests to a session backend. (We aren't using these bearer tokens in this demo, but you can learn more about them [here](https://docs.jamsocket.com/backend-authentication/)).

Note that `Page` is rendered in a server-side component. This ensures that your secrets aren't leaked to the client. Once we receive the spawn result, the `Page` component will pass that information to the `HomeContainer` component. 

```ts title="src/app/page.tsx"
import { spawnBackend } from '../lib/jamsocket'

// NOTE: we want to keep the JAMSOCKET_TOKEN secret, so we can only do this in a server component
// import 'server-only' at the top of this file to ensure these values are never included in the client bundle
const JAMSOCKET_ACCOUNT = '[FILL ME IN]'
const JAMSOCKET_SERVICE = 'whiteboard-demo'
const JAMSOCKET_TOKEN = '[FILL ME IN]'
const WHITEBOARD_NAME = 'whiteboard-demo/default'

export default async function Page() {
  const spawnResult = await spawnBackend(
    JAMSOCKET_ACCOUNT,
    JAMSOCKET_SERVICE,
    JAMSOCKET_TOKEN,
    WHITEBOARD_NAME
  )
  return <HomeContainer spawnResult={spawnResult} />
}
```

At this point, the typechecker will have some complaints. Let's fix those in the next section.

## Connecting to our session backend

To connect to our session backend, the `HomeContainer` component should accept `spawnResult` as props and pass that into the `JamsocketBackendProvider`. The `JamsocketBackendProvider` lets us use the React hooks in `lib/jamsocket-backend` to interact with the session backend. 

```ts title="src/components/Home.tsx"
import { JamsocketBackendProvider } from '../lib/jamsocket-backend'
import type { SpawnResult } from '../lib/jamsocket'

export default function HomeContainer({ spawnResult }: { spawnResult: SpawnResult }) {
  return <JamsocketBackendProvider spawnResult={spawnResult}>
    <Home />
  </JamsocketBackendProvider>
}
```

Now, in our `Home` component, we can use the `useEventListener` hook to listen for our `user-entered` and `user-exited` events.

Let's keep track of which users are in the document with some component state. And we can pass that list of users to our `AvatarList` component which will render an avatar in the header for each user who is currently in the document.

```ts title="src/components/Home.tsx"
import type { User } from './Whiteboard'
import {AvatarList} from './Whiteboard'
// ...
function Home() {
  const [users, setUsers] = useState<User[]>([])
  // ...
  <Header>
    <AvatarList users={users} />
  </Header>
}
```

Next, let's import the `useEventListener` hook that we'll use to subscribe to the WebSocket events we're sending from our session backend:

```ts title="src/components/Home.tsx"
import { JamsocketBackendProvider, useEventListener } from '../lib/jamsocket-backend'
```

Then we can subscribe to the events with our hook. On the `user-entered` event, we should create a user object with an `id` and a `cursorX` and `cursorY` property (we'll use these when we implement cursor presence). And on the `user-exited` event, let's just remove the user from the list of users in our component state.

```ts title="src/components/Home.tsx" hl_lines="3 4 5 6 8 9 10"
function Home() {
  // ...
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

```ts title="src/components/Home.tsx"
import { JamsocketBackendProvider, useEventListener, useReady } from '../lib/jamsocket-backend'
// ...
const ready = useReady()
```

Finally - the moment of truth. Let's push our session backend code to Jamsocket and then load the page to see if everything works!

Pushing our code to Jamsocket currently just means building the session-backend code into a Docker image and using the Jamsocket CLI to push it to our container registry. So let's build our docker image using `Dockerfile.jamsocket`, for the `linux/amd64` platform, and give it the tag `whiteboard-demo`.

```
docker build -t whiteboard-demo --platform=linux/amd64 -f Dockerfile.jamsocket .
```

Then let's push our new `whiteboard-demo` Docker image to our `whiteboard-demo` service.

```
npx jamsocket@latest push whiteboard-demo whiteboard-demo
```

If `npm run dev` is still running, you should be able to refresh the page and see an avatar in the header. And if you open the app in another tab, another avatar should appear. Note that it may take a second for the backend to start up initially.

When we list our running backends with the CLI, we should see that our server component spawned a backend:

```sh
npx jamsocket@latest backend list
```

And using the name of that backend, you can stream its logs via the CLI:

```sh
npx jamsocket@latest logs [BACKEND]
```

## Implementing cursor presence

Most of the hard work is behind us, so let's add a few more events. Let's keep track of the cursor position for each user so we can display that on top of the whiteboard.

We'll start by subscribing to a `cursor-position` event and updating our list of users with the user passed to it:

```ts title="src/components/Home.tsx" hl_lines="3 4 5"
function Home() {
  // ...
  useEventListener<User>('cursor-position', (user) => {
    setUsers((users) => users.map((p) => p.id === user.id ? user : p))
  })
  // ...
}
```

Then we need to send a `cursor-position` event to the session backend as our cursor moves over the whiteboard.

We can do this by importing the `useSend` hook and then creating a `sendEvent` function with it:

```ts title="src/components/Home.tsx" hl_lines="1 5"
import { JamsocketBackendProvider, useEventListener, useReady, useSend } from '../lib/jamsocket-backend'

function Home() {
  // ...
  const sendEvent = useSend()
  // ...
}
```

Then, we can pass a `users` prop and an `onCursorMove` prop to our `<Whiteboard>` component, that takes the cursor's position and sends it to our session backend.

```ts title="src/components/Home.tsx" hl_lines="2 3 4 5"
<Whiteboard
  users={users}
  onCursorMove={(position) => {
    sendEvent('cursor-position', { x: position?.x, y: position?.y })
  }
/>
```

Now we just need to add a `cursor-position` event to our session backend code. In our `src/session-backend/index.ts` file let's subscribe to the `cursor-position` event and emit a `cursor-position` event to all connected clients. We can use `volatile.broadcast` here because it's okay if we drop a couple `cursor-position` events here and there. For cursor positions, we really just care about the most recent cursor position message.

```ts title="src/session-backend/index.ts" hl_lines="3 4 5"
io.on('connection', (socket: Socket) => {
  console.log('New user connected:', socket.id)
  socket.on('cursor-position', ({ x, y }) => {
    socket.volatile.broadcast.emit('cursor-position', { id: socket.id, cursorX: x, cursorY: y })
  })
  // ...
})
```

Okay, with that, we're ready to rebuild our backend, push our updates, and refresh.

```
docker build -t whiteboard-demo --platform=linux/amd64 -f Dockerfile.jamsocket .
npx jamsocket@latest push whiteboard-demo whiteboard-demo
```

We should also terminate the backend that's currently running. If we don't, refreshing the page will just connect us to the one that's already running, which doesn't have the code updates we've just added.

```
npx jamsocket@latest backend list
npx jamsocket@latest terminate [BACKEND]
```

Now, let's open the application in a few browser tabs. If everything works, moving your cursor over one canvas should display a cursor on the other connected clients.

## Implementing shared state

The last thing we want to do in this demo is implement state-sharing. Right now, when you refresh the page, you lose all the shapes you've drawn. And when another connected client draws shapes, you can't see them. Let's fix that.

This time, we'll start with our session backend code. Let's create an array to store all the shapes. When a new user connects, we'll send them a snapshot of all the shapes. Let's also listen for two new events: `create-shape` and `update-shape`, which will update our list of shapes accordingly.

```ts title="src/session-backend/index.ts" hl_lines="1 3 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21"
import type { Shape } from '../components/Whiteboard'
// ...
const shapes: Shape[] = []
io.on('connection', (socket: Socket) => {
  // ...
  socket.emit('snapshot', shapes)

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

With that, we can rebuild our session backend code and push to Jamsocket.

```
docker build -t whiteboard-demo --platform=linux/amd64 -f Dockerfile.jamsocket .
npx jamsocket@latest push whiteboard-demo whiteboard-demo
```

Now, let's add our `sendEvent()` and `useEventListener()` calls to the `Home` component.

First, we should listen for our new `snapshot` and `update-shape` events:

```ts title="src/components/Home.tsx" hl_lines="3 4 5 6 7 8 9 10 11 12 13"
function Home() {
  // ...
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

```ts title="src/components/Home.tsx" hl_lines="2 3 4 5 6 7 8 9"
<Whiteboard
  onCreateShape={(shape) => {
    sendEvent('create-shape', shape)
    setShapes([...shapes, shape])
  }}
  onUpdateShape={(id, shape) => {
    sendEvent('update-shape', { id, ...shape })
    setShapes((shapes) => shapes.map((s) => s.id === id ? { ...s, ...shape } : s))
  }}
  // ...
/>
```

Now, all that's left is for us to make sure we don't have any running backends, and then refresh the page:

```
npx jamsocket@latest backend list
npx jamsocket@latest terminate [BACKEND]
```

When you open the app in more than one tab, you should see:

* an avatar for each user
* each user's cursor as it hovers over the whiteboard
* all the same shapes as they are created and moved around the screen

## What's next?
  - Learn about how to persist your document state when a session backend stops. (Coming soon)
  - Learn about how to authenticate your users when connecting to a session backend (Coming soon)

If you have any questions about how to use Jamsocket or would like to talk through your particular use case, we'd love to chat! Send us an email at [hi@driftingin.space](mailto:hi@driftingin.space)!
