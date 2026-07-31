import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(async () => {
  try {
    const db = mongoose.connection.db;
    await db.collection("socket_io_events").drop();
    console.log("Dropped socket_io_events collection");
  } catch (err) {
    console.error("Could not drop collection:", err.message);
  }
  process.exit(0);
});
