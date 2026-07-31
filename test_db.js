import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(async () => {
  const users = mongoose.connection.collection('users');
  const contacts = mongoose.connection.collection('contacts');
  
  console.log("Users:", await users.find({}).toArray());
  console.log("Contacts:", await contacts.find({}).toArray());
  
  mongoose.disconnect();
});
