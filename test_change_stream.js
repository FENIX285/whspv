import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(async () => {
  const collection = mongoose.connection.collection('users');
  try {
    const stream = collection.watch();
    stream.on('change', (change) => {
      console.log("Change:", change);
    });
    console.log("Change stream started successfully");
    
    await collection.insertOne({ test: 1 });
    await new Promise(r => setTimeout(r, 1000));
    await collection.deleteOne({ test: 1 });
    
    setTimeout(() => process.exit(0), 2000);
  } catch (e) {
    console.error("Change stream error:", e.message);
    process.exit(1);
  }
});
