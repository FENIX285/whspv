import { io } from "socket.io-client";

const URL = "http://localhost:3000";
const A_ID = "testUserA";
const A_PASS = "passA";
const B_ID = "testUserB";
const B_PASS = "passB";

const socketA = io(URL, { path: "/socket.io" });
const socketB = io(URL, { path: "/socket.io" });

socketA.on("connect", () => {
  socketA.emit("login", { userId: A_ID, hashedPassword: A_PASS }, (res) => {
    console.log("A login:", res);
    socketA.emit("add_contact", { contactId: B_ID, alias: "B" }, () => {
       console.log("A added B");
    });
  });
});

socketB.on("connect", () => {
  socketB.emit("login", { userId: B_ID, hashedPassword: B_PASS }, (res) => {
    console.log("B login:", res);
    socketB.emit("add_contact", { contactId: A_ID, alias: "A" }, () => {
       console.log("B added A");
       
       // Now get contacts for A
       setTimeout(() => {
         socketA.emit("get_contacts", {}, (res) => {
           console.log("A contacts:", res.contacts);
           process.exit(0);
         });
       }, 500);
    });
  });
});
