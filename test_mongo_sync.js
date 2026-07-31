import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(async () => {
  const collection = mongoose.connection.collection('socket_io_events');
  const io = new Server();
  io.adapter(createAdapter(collection));
  
  io.on('connection', (socket) => {
    socket.join("test_room");
  });
  
  io.listen(3001);
  console.log("Listening on 3001");
});
