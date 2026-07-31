import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(async () => {
  const collection = mongoose.connection.collection('socket_io_events');
  const io = new Server();
  io.adapter(createAdapter(collection));
  
  console.log("Waiting 5s for adapter to initialize...");
  setTimeout(async () => {
    try {
      const sockets = await io.in("test_room").fetchSockets();
      console.log("Sockets in test_room from another node:", sockets.length);
    } catch (e) {
      console.error(e);
    }
    process.exit(0);
  }, 5000);
});
