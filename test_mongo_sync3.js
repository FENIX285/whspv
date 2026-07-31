import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(async () => {
  const collection = mongoose.connection.collection('socket_io_events');
  const io = new Server();
  io.adapter(createAdapter(collection));
  
  console.log("Waiting 2s, then emitting...");
  setTimeout(async () => {
    io.to("test_room").emit("hello", "world");
    console.log("Emitted.");
    setTimeout(() => process.exit(0), 1000);
  }, 2000);
});
