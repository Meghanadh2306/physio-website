const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("./models/admin");

const router = express.Router();

router.post("/change-password", async (req, res) => {
  try {
const { oldPassword, newPassword } = req.body;

const header = req.headers.authorization;
if (!header) {
  return res.status(401).json({ message: "Token missing" });
}

const token = header.startsWith("Bearer ")
  ? header.split(" ")[1]
  : header;

if (!oldPassword || !newPassword) {
  return res.status(400).json({ message: "All fields required" });
}
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id);

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const match = await bcrypt.compare(oldPassword, admin.password);
    if (!match) {
      return res.status(401).json({ message: "Old password incorrect" });
    }

    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();

    res.json({ message: "✅ Password changed successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
