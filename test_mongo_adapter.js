import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(async () => {
  console.log("Connected");
  const collection = mongoose.connection.collection('socket_io_events');
  const io = new Server();
  try {
    io.adapter(createAdapter(collection));
    console.log("Adapter created successfully");
  } catch (e) {
    console.error("Failed to create adapter:", e);
  }
  process.exit(0);
});
