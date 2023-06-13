import { Server, type Socket } from 'socket.io'

const io = new Server(8080, { cors: { origin: '*' } })

io.on('connection', (socket: Socket) => {
  console.log('New user connected:', socket.id)
})
