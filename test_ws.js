import { io } from "socket.io-client";

const URL = "http://localhost:3000";
const A_ID = "8adcd8f1f3ad49d9";
const A_PASS = "06dde341f9e37339ae62310349e2f39b4e5dee07397033d404e6394bae42ab7e";
const B_ID = "8bfe4e48cff74649";
const B_PASS = "8c1df98d827e50f4007adf748d5a59a1795c252995727044d39db326779af692";

const socketA = io(URL, { path: "/socket.io" });
const socketB = io(URL, { path: "/socket.io" });

socketA.on("connect", () => {
  socketA.emit("login", { userId: A_ID, hashedPassword: A_PASS }, (res) => {
    console.log("A login:", res);
    setTimeout(() => {
      socketA.emit("signal", { to: B_ID, type: "offer", payload: { sdp: "test" } }, (res) => {
        console.log("A sent signal:", res);
      });
    }, 1000);
  });
});

socketB.on("connect", () => {
  socketB.emit("login", { userId: B_ID, hashedPassword: B_PASS }, (res) => {
    console.log("B login:", res);
  });
});

socketB.on("signal", (msg) => {
  console.log("B received signal:", msg);
  setTimeout(() => process.exit(0), 500);
});
