const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URL);

const AdminSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});

const Admin = mongoose.model("Admin", AdminSchema);

async function createAdmin(){
  const exists = await Admin.findOne({ username: "admin" });
  if(exists){
    console.log("⚠️ Admin already exists");
    process.exit();
  }

  const hashed = await bcrypt.hash("admin123", 10);

  await Admin.create({
    username: "sriphysio",
    password: hashed
  });

  console.log("✅ Admin created");
  process.exit();
}

createAdmin();
