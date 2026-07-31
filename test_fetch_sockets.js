import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(async () => {
  const collection = mongoose.connection.collection('socket_io_events');
  const io = new Server();
  io.adapter(createAdapter(collection));
  
  try {
    const sockets = await io.in("some_room").fetchSockets();
    console.log("Fetch sockets works:", sockets.length);
  } catch (e) {
    console.error("Fetch sockets failed:", e);
  }
  process.exit(0);
});
