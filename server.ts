// @ts-nocheck
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import mongoose from "mongoose";

const PORT = process.env.PORT || 3000;

async function startServer() {
  const app = express();

  const MONGODB_URI = process.env.MONGODB_URI;
  if (MONGODB_URI) {
    try {
      await mongoose.connect(MONGODB_URI);
      console.log("Connected to MongoDB");
    } catch (err) {
      console.error("MongoDB connection error:", err);
    }
  } else {
    console.warn("MONGODB_URI is not set. Data will not be persisted if models are used.");
  }

  const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    hashedPassword: { type: String, required: true },
    lastPing: { type: Date }
  });
  const User = mongoose.models.User || mongoose.model("User", userSchema);

  const contactSchema = new mongoose.Schema({
    ownerId: { type: String, required: true },
    contactId: { type: String, required: true },
    alias: { type: String, default: "Unknown" },
  });
  const Contact = mongoose.models.Contact || mongoose.model("Contact", contactSchema);

  const signalSchema = new mongoose.Schema({
    to: { type: String, required: true },
    from: { type: String, required: true },
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, expires: '1m', default: Date.now }
  });
  const Signal = mongoose.models.Signal || mongoose.model("Signal", signalSchema);

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  // Watch for WebRTC signals from other instances
  if (MONGODB_URI) {
    try {
      Signal.watch().on('change', (change) => {
        if (change.operationType === 'insert') {
          const doc = change.fullDocument;
          if (doc && doc.to) {
            io.to(doc.to).emit("signal", { from: doc.from, type: doc.type, payload: doc.payload });
          }
        }
      });
      console.log("MongoDB Change Stream for Signals initialized");
    } catch (e) {
      console.error("Failed to initialize change stream:", e);
    }
  }

  app.use(express.json());

  io.on("connection", (socket) => {
    let currentUserId: string | null = null;

    socket.on("login", async ({ userId, hashedPassword }, callback) => {
      try {
        let user = await User.findOne({ userId });
        if (!user) {
          // Register automatically
          user = new User({ userId, hashedPassword, lastPing: new Date() });
          await user.save();
          console.log(`[REGISTER] New user ${userId} registered.`);
        } else if (user.hashedPassword !== hashedPassword) {
          if (callback) callback({ success: false });
          return;
        }
        
        currentUserId = userId;
        socket.join(userId);
        
        await User.updateOne({ userId }, { $set: { lastPing: new Date() } });
        console.log(`[LOGIN] User ${userId} logged in on socket ${socket.id}.`);
        
        if (callback) callback({ success: true });
      } catch (err) {
        console.error("Login error:", err);
        if (callback) callback({ success: false, error: "Server error" });
      }
    });

    socket.on("ping_presence", async () => {
      if (currentUserId) {
        await User.updateOne({ userId: currentUserId }, { $set: { lastPing: new Date() } });
      }
    });

    socket.on("get_contacts", async (data, callback) => {
      if (!currentUserId) return callback({ success: false, error: "Not authenticated" });
      try {
        const contacts = await Contact.find({ ownerId: currentUserId });
        const response = [];
        
        const now = Date.now();
        
        for (const c of contacts) {
          const mutual = await Contact.findOne({ ownerId: c.contactId, contactId: currentUserId });
          let isOnline = false;
          
          if (mutual) {
            const contactUser = await User.findOne({ userId: c.contactId });
            if (contactUser && contactUser.lastPing) {
               const diff = now - contactUser.lastPing.getTime();
               // Use 90 seconds (90000ms) to allow for background tab throttling
               isOnline = diff < 90000;
               console.log(`[PRESENCE] ${currentUserId} checking ${c.contactId}: mutual=true, diff=${diff}ms, isOnline=${isOnline}`);
            } else {
               console.log(`[PRESENCE] ${currentUserId} checking ${c.contactId}: mutual=true, contactUser=${!!contactUser}, lastPing=${contactUser?.lastPing}`);
            }
          } else {
             console.log(`[PRESENCE] ${currentUserId} checking ${c.contactId}: mutual=false`);
          }
          
          response.push({
            contactId: c.contactId,
            alias: c.alias,
            mutual: !!mutual,
            online: isOnline,
          });
        }
        callback({ success: true, contacts: response });
      } catch (err) {
        console.error("Get contacts error:", err);
        callback({ success: false, error: "Server error" });
      }
    });

    socket.on("add_contact", async ({ contactId, alias }, callback) => {
      if (!currentUserId) return callback({ success: false, error: "Not authenticated" });

    socket.on("remove_contact", async ({ contactId }, callback) => {
      try {
        await User.updateOne(
          { userId },
          { $pull: { contacts: { contactId } } }
        );
        callback({ success: true });
      } catch (e) {
        callback({ success: false });
      }
    });

    socket.on("update_contact_alias", async ({ contactId, alias }, callback) => {
      try {
        await User.updateOne(
          { userId, "contacts.contactId": contactId },
          { $set: { "contacts.$.alias": alias } }
        );
        callback({ success: true });
      } catch (e) {
        callback({ success: false });
      }
    });
      try {
        const userExists = await User.findOne({ userId: contactId });
        if (!userExists) {
          return callback({ success: false, error: "Contact does not exist" });
        }

        await Contact.findOneAndUpdate(
          { ownerId: currentUserId, contactId },
          { alias },
          { upsert: true }
        );

        callback({ success: true });
      } catch (err) {
        console.error("Add contact error:", err);
        callback({ success: false, error: "Server error" });
      }
    });

    socket.on("delete_contact", async ({ contactId }, callback) => {
      if (!currentUserId) return callback({ success: false, error: "Not authenticated" });
      try {
        await Contact.findOneAndDelete({ ownerId: currentUserId, contactId });
        callback({ success: true });
      } catch (err) {
        console.error("Delete contact error:", err);
        callback({ success: false, error: "Server error" });
      }
    });

    socket.on("signal", async ({ to, type, payload }, callback) => {
      if (!currentUserId) return callback && callback({ success: false, error: "Not authenticated" });
      try {
        await Signal.create({ to, from: currentUserId, type, payload });
        if (callback) callback({ success: true });
      } catch (err) {
        console.error("Signal error:", err);
        if (callback) callback({ success: false, error: "Server error" });
      }
    });

    socket.on("disconnect", async () => {
      if (currentUserId) {
        socket.leave(currentUserId);
        currentUserId = null;
      }
    });
  });

  // API Routes
  app.post("/api/register", async (req, res) => {
    try {
      const { userId, hashedPassword } = req.body;
      const existing = await User.findOne({ userId });
      if (existing) {
        return res.status(400).json({ error: "User already exists" });
      }
      const user = new User({ userId, hashedPassword, lastPing: new Date() });
      await user.save();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

startServer();
