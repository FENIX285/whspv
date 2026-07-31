import { io } from "socket.io-client";
const socket = io("http://localhost:3001");
socket.on("connect", () => {
  console.log("Client connected");
});
socket.on("hello", (msg) => {
  console.log("Received hello:", msg);
});
