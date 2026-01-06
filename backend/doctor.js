const express = require("express");
const Doctor = require("./models/doctor");
const jwt = require("jsonwebtoken");

const router = express.Router();

/* AUTH */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: "Token missing" });

  const token = header.split(" ")[1];
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

/* GET DOCTORS */
router.get("/", auth, async (req, res) => {
  const doctors = await Doctor.find().sort({ name: 1 });
  res.json(doctors);
});

/* ADD DOCTOR */
router.post("/", auth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "Name required" });

  const exists = await Doctor.findOne({ name });
  if (exists) return res.status(409).json({ message: "Doctor already exists" });

  const doctor = await Doctor.create({ name });
  res.json(doctor);
});

/* DELETE DOCTOR */
router.delete("/:id", auth, async (req, res) => {
  await Doctor.findByIdAndDelete(req.params.id);
  res.json({ message: "Doctor deleted" });
});

module.exports = router;
