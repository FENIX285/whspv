import { io } from "socket.io-client";
const socketA = io("http://localhost:3000", { path: "/socket.io" });
const socketB = io("http://localhost:3000", { path: "/socket.io" });

socketA.on("connect", () => {
  socketA.emit("login", { userId: "A", hashedPassword: "X" }, () => {
    socketA.emit("add_contact", { contactId: "B", alias: "B" }, () => {});
  });
});

socketB.on("connect", () => {
  socketB.emit("login", { userId: "B", hashedPassword: "X" }, () => {
    socketB.emit("add_contact", { contactId: "A", alias: "A" }, () => {
      // both connected
      setTimeout(() => {
        socketA.emit("signal", { to: "B", type: "offer", payload: { sdp: "dummy" } });
      }, 500);
    });
  });
});

socketB.on("signal", (msg) => {
  console.log("B got signal:", msg.type);
  if (msg.type === "offer") {
    socketB.emit("signal", { to: "A", type: "answer", payload: { sdp: "dummy2" } });
  }
});

socketA.on("signal", (msg) => {
  console.log("A got signal:", msg.type);
  if (msg.type === "answer") {
    console.log("SUCCESS");
    process.exit(0);
  }
});

setTimeout(() => {
  console.log("TIMEOUT");
  process.exit(1);
}, 5000);
