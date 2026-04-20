const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors({
  origin: function (origin, callback) {
    // This dynamically allows ANY domain to connect while keeping credentials allowed
    callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

/* ================= ROUTES ================= */
const reportRoutes = require("./report");
app.use("/reports", reportRoutes);
const doctorRoutes = require("./doctor");
app.use("/doctors", doctorRoutes);
const adminRoutes = require("./admin");
app.use("/admin", adminRoutes);

/* ================= MODELS ================= */
const Patient = require("./models/patient");
const Doctor = require("./models/doctor");
const Admin = require("./models/admin");

const Treatment = mongoose.model("Treatment", new mongoose.Schema({
  name: { type: String, unique: true },
  pricePerDay: Number,
  createdAt: { type: Date, default: Date.now }
}));

/* ================= STATIC FILES ================= */
app.use("/assets", express.static(path.resolve(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "..", "frontend")));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB Error:", err);
    process.exit(1);
  });
//invoicde no generater
function generateInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = Math.floor(1000 + Math.random() * 9000);
  return `INV-${y}${m}${d}-${r}`;
}

/* ================= AUTH ================= */
function auth(req, res, next) {
  const header =
    req.headers.authorization ||
    (req.query.token ? `Bearer ${req.query.token}` : null);

  if (!header) {
    return res.status(401).json({ message: "Token missing" });
  }

  const token = header.startsWith("Bearer ")
    ? header.split(" ")[1]
    : header;

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

/* ================= LOGIN ================= */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ username });
  if (!admin) return res.status(401).json({ message: "Invalid credentials" });

  const ok = await bcrypt.compare(password, admin.password);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });

  const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
  res.json({ token });
});

/* ================= BOOK APPOINTMENT ================= */
app.post("/patients", auth, async (req, res) => {
  try {
    console.log("📋 Received appointment request:", JSON.stringify(req.body, null, 2));

    const {
      name,
      age,
      gender,
      address,
      phone,
      appointmentDate,
      treatments,
      problem,
      recommendedDoctor
    } = req.body;

    if (!name || !age || !phone || !appointmentDate || !gender) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!Array.isArray(treatments) || treatments.length === 0) {
      return res.status(400).json({ message: "Please select at least one treatment" });
    }

    if (!recommendedDoctor) {
      return res.status(400).json({ message: "Please select a recommended doctor" });
    }

    // ✅ DATE FIX
    const parsedDate = new Date(appointmentDate);
    if (isNaN(parsedDate)) {
      return res.status(400).json({ message: "Invalid appointment date" });
    }

    const patient = new Patient({
      name,
      age,
      gender,
      address,
      phone: String(phone),          // ✅ FIX
      appointmentDate: parsedDate,   // ✅ FIX
      treatments,
      problem,
      recommendedDoctor,
      totalAmount: 0,
      paidAmount: 0,
      status: "Ongoing",
      treatmentHistory: [],
      paymentHistory: []
    });

    console.log("💾 Saving patient to database...");
    const savedPatient = await patient.save();

    console.log("✅ Patient saved successfully:", savedPatient._id);
    res.json({
      message: "Appointment booked successfully",
      patientId: savedPatient._id
    });

  } catch (err) {
    console.error("❌ Appointment Booking Error:", err.message);
    res.status(500).json({
      message: "Failed to book appointment",
      error: err.message
    });
  }
});

/* ================= PATIENT APIs ================= */
app.get("/patient/:id", auth, async (req, res) => {
  try {
    const p = await Patient.findById(req.params.id);
    if (!p) return res.status(404).json({ message: "Patient not found" });

    res.json({ ...p.toObject(), dueAmount: p.totalAmount - p.paidAmount });

  } catch {
    res.status(400).json({ message: "Invalid patient ID" });
  }
});

app.put("/patient/:id", auth, async (req, res) => {
  try {

    const p = await Patient.findById(req.params.id);
    if (!p) return res.status(404).json({ message: "Patient not found" });

    const { addPaid = 0, paymentType, notes } = req.body;

    if (addPaid > 0) {
      if (!paymentType) {
        return res.status(400).json({ message: "Payment type is required" });
      }

      const patientDue = p.totalAmount - p.paidAmount;

      if (addPaid > patientDue) {
        return res.status(400).json({ message: "Payment exceeds total due amount" });
      }

      p.paidAmount += addPaid;

      // Distribute paid amount among unpaid visits
      let remainingPayment = addPaid;
      if (p.treatmentHistory && p.treatmentHistory.length > 0) {
        for (const v of p.treatmentHistory) {
          let vDue = (v.totalAmount || 0) - (v.paidAmount || 0);
          if (vDue > 0 && remainingPayment > 0) {
            let payToVisit = Math.min(vDue, remainingPayment);
            v.paidAmount = (v.paidAmount || 0) + payToVisit;
            remainingPayment -= payToVisit;
          }
        }
      }

      // Distribute remaining payment to unpaid invoices
      let remainingPaymentForInvoices = addPaid;
      if (p.invoices && p.invoices.length > 0) {
        for (const inv of p.invoices) {
          let invDue = (inv.dueAmount || 0);
          if (invDue > 0 && remainingPaymentForInvoices > 0) {
            let payToInv = Math.min(invDue, remainingPaymentForInvoices);
            inv.paidAmount = (inv.paidAmount || 0) + payToInv;
            inv.dueAmount = invDue - payToInv;
            remainingPaymentForInvoices -= payToInv;
          }
        }
      }

      p.paymentHistory.push({
        entryType: "Payment",
        amount: addPaid,
        paymentType: paymentType,
        date: new Date()
      });
    }

    if (notes) p.notes = notes;
    p.status = p.paidAmount >= p.totalAmount ? "Completed" : "Ongoing";
    await p.save();
    res.json({ message: "Payment updated" });
  } catch (err) {
    console.error("Payment Update Error:", err);
    res.status(500).json({ message: "Update failed", error: err.message });
  }
});

// UPDATE PATIENT DETAILS
app.patch("/patient/:id", auth, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    const { name, age, gender, phone, address, problem, recommendedDoctor, notes, treatments } = req.body;

    // Update fields if provided
    if (name) patient.name = name;
    if (age) patient.age = age;
    if (gender) patient.gender = gender;
    if (phone) patient.phone = phone;
    if (address) patient.address = address;
    if (problem) patient.problem = problem;
    if (recommendedDoctor) patient.recommendedDoctor = recommendedDoctor;
    if (notes !== undefined) patient.notes = notes;
    if (treatments !== undefined) patient.treatments = treatments;

    await patient.save();
    res.json({ message: "Patient details updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update patient" });
  }
});

app.put("/patient/:id/attendance", auth, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const { date, action } = req.body; // action: "add" or "remove"
    if (!patient.attendance) patient.attendance = [];

    if (action === "add") {
      if (!patient.attendance.includes(date)) patient.attendance.push(date);
    } else if (action === "remove") {
      patient.attendance = patient.attendance.filter(d => d !== date);
    }

    await patient.save();
    res.json({ message: "Attendance updated", attendance: patient.attendance });
  } catch (err) {
    console.error("Attendance error:", err);
    res.status(500).json({ message: "Failed to update attendance" });
  }
});

// DELETE PAYMENT
app.delete("/patient/:id/payment/:paymentIndex", auth, async (req, res) => {
  try {
    const p = await Patient.findById(req.params.id);
    if (!p) return res.status(404).json({ message: "Patient not found" });

    const paymentIndex = parseInt(req.params.paymentIndex);
    if (paymentIndex < 0 || paymentIndex >= p.paymentHistory.length) {
      return res.status(400).json({ message: "Invalid payment index" });
    }

    const removedPayment = p.paymentHistory[paymentIndex];
    if (removedPayment.entryType === "Payment") {
      p.paidAmount -= removedPayment.amount;
      if (p.paidAmount < 0) p.paidAmount = 0;

      let visitReverse = removedPayment.amount;
      if (p.treatmentHistory && p.treatmentHistory.length > 0) {
        for (let i = p.treatmentHistory.length - 1; i >= 0; i--) {
          let v = p.treatmentHistory[i];
          if (v.paidAmount > 0 && visitReverse > 0) {
            let refund = Math.min(v.paidAmount, visitReverse);
            v.paidAmount -= refund;
            visitReverse -= refund;
          }
        }
      }

      let invReverse = removedPayment.amount;
      if (p.invoices && p.invoices.length > 0) {
        for (let i = p.invoices.length - 1; i >= 0; i--) {
          let inv = p.invoices[i];
          if (inv.paidAmount > 0 && invReverse > 0) {
            let refund = Math.min(inv.paidAmount, invReverse);
            inv.paidAmount -= refund;
            inv.dueAmount = (inv.dueAmount || 0) + refund;
            invReverse -= refund;
          }
        }
      }
    }

    p.paymentHistory.splice(paymentIndex, 1);
    p.status = p.paidAmount >= p.totalAmount ? "Completed" : "Ongoing";
    await p.save();

    res.json({ message: "Payment deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete payment" });
  }
});

app.post("/patient/:id/treatments/add", auth, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    const { treatments, totalAmount, endDate, startDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Start and End date required" });
    }
    // 1️⃣ Save treatment history
    patient.treatmentHistory.push({
      startDate,
      endDate,
      treatments,
      totalAmount,
      paidAmount: 0
    });

    patient.totalAmount += totalAmount;
    patient.endDate = endDate;

    // 2️⃣ AUTO GENERATE INVOICE
    const invoiceNumber = generateInvoiceNumber();

    if (!patient.invoices) patient.invoices = [];

    patient.invoices.push({
      invoiceNumber,
      treatmentStartDate: startDate,
      treatmentEndDate: endDate,
      totalAmount,
      paidAmount: 0,
      dueAmount: totalAmount,
      createdAt: new Date()
    });



    patient.status =
      patient.paidAmount >= patient.totalAmount ? "Completed" : "Ongoing";

    await patient.save();

    res.json({
      message: "Treatment & Invoice saved",
      invoiceNumber
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save treatment" });
  }
});


// DELETE PATIENT
app.delete("/patient/:id", auth, async (req, res) => {
  try {
    const result = await Patient.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Patient not found" });
    }
    res.json({ message: "Patient deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete patient", error: error.message });
  }
});

/* ================= DELETE VISIT ================= */
app.delete("/patient/:id/visit/:visitIndex", auth, async (req, res) => {
  try {
    const { id, visitIndex } = req.params;
    const index = parseInt(visitIndex, 10);

    const patient = await Patient.findById(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    if (!patient.treatmentHistory || index < 0 || index >= patient.treatmentHistory.length) {
      return res.status(404).json({ message: "Visit not found" });
    }

    const visitToDelete = patient.treatmentHistory[index];

    // Deduct total amount
    if (visitToDelete.totalAmount) {
      patient.totalAmount -= visitToDelete.totalAmount;
      if (patient.totalAmount < 0) patient.totalAmount = 0;
    }

    // Attempt to reverse the paidAmount from this visit
    let amountToReverse = visitToDelete.paidAmount || 0;

    // Find and remove corresponding invoice
    if (patient.invoices && patient.invoices.length > 0) {
      const invIndex = patient.invoices.findIndex(inv =>
        inv.treatmentStartDate === visitToDelete.startDate &&
        inv.treatmentEndDate === visitToDelete.endDate
      );
      if (invIndex !== -1) {
        amountToReverse = Math.max(amountToReverse, patient.invoices[invIndex].paidAmount || 0);
        patient.invoices.splice(invIndex, 1);
      }
    }

    if (amountToReverse > 0) {
      patient.paidAmount -= amountToReverse;
      if (patient.paidAmount < 0) patient.paidAmount = 0;

      // Keep ledger consistent
      patient.paymentHistory.push({
        entryType: "Refund/Reversal",
        amount: amountToReverse,
        paymentType: "System Adjustment (Visit Deleted)",
        date: new Date()
      });
    }

    // Remove visit
    patient.treatmentHistory.splice(index, 1);

    patient.status = patient.paidAmount >= patient.totalAmount ? "Completed" : "Ongoing";
    if (patient.totalAmount === 0 && patient.paidAmount === 0) patient.status = "Ongoing";

    await patient.save();
    res.json({ message: "Visit deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete visit" });
  }
});

//doctor list
app.post("/doctors", auth, async (req, res) => {
  try {
    const doctor = await Doctor.create(req.body);
    res.json(doctor);
  } catch {
    res.status(400).json({ message: "Doctor already exists" });
  }
});
app.get("/doctors", auth, async (req, res) => {
  res.json(await Doctor.find().sort({ name: 1 }));
});
//delete doctor
app.delete("/doctors/:id", auth, async (req, res) => {
  try {
    const result = await Doctor.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Doctor not found" });
    }
    res.json({ message: "Doctor deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete doctor", error: error.message });
  }
});

/* ================= PATIENT LIST ================= */
app.get("/patients", auth, async (req, res) => {
  const { search, status, doctor, month, year } = req.query;
  let filter = {};

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } }
    ];
  }
  if (status) filter.status = status;
  if (doctor) filter.recommendedDoctor = doctor;

  // Month and year filter for appointmentDate OR treatmentHistory.date
  if (month && year) {
    const m = parseInt(month, 10) - 1;
    const y = parseInt(year, 10);
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    filter.$or = [
      { appointmentDate: { $gte: start, $lt: end } },
      { 'treatmentHistory.date': { $gte: start, $lt: end } }
    ];
    // If search is also present, combine $and
    if (search) {
      filter = {
        $and: [
          {
            $or: [
              { name: { $regex: search, $options: "i" } },
              { phone: { $regex: search, $options: "i" } }
            ]
          },
          {
            $or: [
              { appointmentDate: { $gte: start, $lt: end } },
              { 'treatmentHistory.date': { $gte: start, $lt: end } }
            ]
          }
        ]
      };
      if (status) filter.$and.push({ status });
      if (doctor) filter.$and.push({ recommendedDoctor: doctor });
    } else {
      if (status) filter.status = status;
      if (doctor) filter.recommendedDoctor = doctor;
    }
  }

  const patients = await Patient.find(filter).sort({ createdAt: -1 });
  res.json(patients.map(p => ({
    ...p.toObject(),
    dueAmount: p.totalAmount - p.paidAmount
  })));
});

/* ================= INVOICE HISTORY ================= */
app.get("/patient/:id/invoices", auth, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.json([]);

    res.json(patient.invoices || []);
  } catch (err) {
    res.status(500).json([]);
  }
});

/* ================= DELETE INVOICE ================= */
app.delete("/patient/:id/invoice/:invoiceNumber", auth, async (req, res) => {
  try {
    const { id, invoiceNumber } = req.params;

    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    if (!patient.invoices || !patient.invoices.length) {
      return res.status(404).json({ message: "No invoices found" });
    }

    // Find invoice to get details
    const invoiceToDelete = patient.invoices.find(inv => inv.invoiceNumber === invoiceNumber);

    if (!invoiceToDelete) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Find and remove corresponding treatment history entry
    let treatmentToDelete = null;
    let deductedFromTotal = false;

    if (patient.treatmentHistory && patient.treatmentHistory.length > 0) {
      const treatmentIndex = patient.treatmentHistory.findIndex(
        th => th.startDate === invoiceToDelete.treatmentStartDate &&
          th.endDate === invoiceToDelete.treatmentEndDate
      );

      if (treatmentIndex !== -1) {
        treatmentToDelete = patient.treatmentHistory[treatmentIndex];
        patient.treatmentHistory.splice(treatmentIndex, 1);

        // Deduct from total amount
        if (treatmentToDelete.totalAmount) {
          patient.totalAmount -= treatmentToDelete.totalAmount;
          deductedFromTotal = true;
        }
      }
    }

    if (!deductedFromTotal && invoiceToDelete.totalAmount) {
      patient.totalAmount -= invoiceToDelete.totalAmount;
    }
    if (patient.totalAmount < 0) patient.totalAmount = 0;

    // Remove invoice
    patient.invoices = patient.invoices.filter(
      inv => inv.invoiceNumber !== invoiceNumber
    );

    // Delete all related payments (all payments that were made for this treatment visit)
    const amountToReverse = invoiceToDelete.paidAmount || (treatmentToDelete ? (treatmentToDelete.paidAmount || 0) : 0);

    if (amountToReverse > 0) {
      patient.paidAmount -= amountToReverse;
      if (patient.paidAmount < 0) patient.paidAmount = 0;

      // Keep ledger consistent without destroying all payments
      patient.paymentHistory.push({
        entryType: "Refund/Reversal",
        amount: amountToReverse,
        paymentType: "System Adjustment (Invoice Deleted)",
        date: new Date()
      });
    }

    // Recalculate status
    patient.status = patient.paidAmount >= patient.totalAmount ? "Completed" : "Ongoing";

    await patient.save();

    res.json({ message: "Invoice, treatment history, and related payments deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete invoice" });
  }
});

//* ================= TREATMENT MASTER ================= */
app.get("/treatments", auth, async (req, res) => {
  res.json(await Treatment.find().sort({ name: 1 }));
});

app.post("/treatments", auth, async (req, res) => {
  try {
    // Prevent duplicate names (case-insensitive)
    const existing = await Treatment.findOne({ name: { $regex: `^${req.body.name}$`, $options: 'i' } });
    if (existing) {
      return res.status(400).json({ message: "Treatment already exists" });
    }
    const treatment = await Treatment.create(req.body);
    res.json(treatment);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to create treatment" });
  }
});

app.delete("/treatments/:id", auth, async (req, res) => {
  await Treatment.findByIdAndDelete(req.params.id);
  res.json({ message: "Treatment deleted" });
});
// UPDATE TREATMENT PRICE
app.put("/treatments/:id", auth, async (req, res) => {
  const { pricePerDay } = req.body;

  await Treatment.findByIdAndUpdate(req.params.id, {
    pricePerDay
  });

  res.json({ message: "Treatment updated" });
});


/* ================= FRONTEND PAGES ================= */
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"))
);

app.get("/dashboard", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "frontend", "dashboard.html"))
);

app.get("/appointment", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "frontend", "appointment.html"))
);

app.get("/doctor", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "frontend", "doctor.html"))
);
app.get("/reports-page", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "frontend", "reports-dashboard.html"))
);

app.get("/patient-page", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "frontend", "patient.html"))
);


/* ================= INVOICE PDF ================= */
function formatDateDMY(dateValue) {
  if (!dateValue) return "-";
  const d = new Date(dateValue);
  if (isNaN(d)) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

app.get("/invoice/:id", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).send("Token missing");
    jwt.verify(token, process.env.JWT_SECRET);

    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).send("Patient not found");

    // ✅ ADD HERE (THIS IS THE PLACE)
    const requestedInvoiceNo = req.query.invoice;

    let invoice;
    if (requestedInvoiceNo) {
      invoice = patient.invoices.find(
        i => i.invoiceNumber === requestedInvoiceNo
      );
    } else {
      invoice = patient.invoices?.at(-1);
    }

    // PDF creation starts AFTER this
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${patient.name}_invoice.pdf`);
    doc.pipe(res);
    /* HEADER */
    doc.image(path.join(__dirname, "assets", "logo.jpg"), 0, 0, { width: doc.page.width });
    doc.y = 280;
    /* ================= DIVIDER ================= */
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);

    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(14).text("Patient Details", 50);
    doc.moveDown(0.5);

    // Box
    const boxY = doc.y;
    doc
      .roundedRect(40, boxY, 515, 90, 8)
      .stroke();

    doc.font("Helvetica").fontSize(11);

    doc.text(`Name      : ${patient.name}`, 55, boxY + 10);
    doc.text(`Phone     : ${patient.phone}`, 55, boxY + 28);
    doc.text(`Gender    : ${patient.gender || "-"}`, 300, boxY + 10);
    doc.text(`Age       : ${patient.age}`, 300, boxY + 28);
    doc.text(`Address   : ${patient.address || "-"}`, 300, boxY + 46);
    doc.text(`Start Date: ${formatDateDMY(invoice?.treatmentStartDate)}`, 55, boxY + 46);
    doc.text(`End Date  : ${formatDateDMY(invoice?.treatmentEndDate || patient.endDate)}`, 55, boxY + 64);
    doc.text(`Invoice No: ${invoice?.invoiceNumber || "-"}`, 300, boxY + 64);

    doc.y = boxY + 105;

    /* TABLE */
    doc.font("Helvetica-Bold").fontSize(13).text("Treatment Details");
    doc.moveDown(0.5);

    const startY = doc.y;
    doc.text("Treatment", 50, startY);
    doc.text("Price/Day", 250, startY);
    doc.text("Days", 340, startY);
    doc.text("Amount", 420, startY);

    doc.moveTo(40, startY + 15).lineTo(555, startY + 15).stroke();

    let targetVisit = null;
    if (invoice && patient.treatmentHistory) {
      targetVisit = patient.treatmentHistory.find(th =>
        th.startDate === invoice.treatmentStartDate && th.endDate === invoice.treatmentEndDate
      );
    }
    if (!targetVisit && patient.treatmentHistory) {
      targetVisit = patient.treatmentHistory.at(-1);
    }

    const treatments = targetVisit ? targetVisit.treatments : [];

    let y = startY + 25;
    doc.font("Helvetica").fontSize(11);

    treatments.forEach(t => {
      doc.text(t.treatmentName, 50, y);
      doc.text(`₹ ${t.pricePerDay}`, 250, y);
      doc.text(t.days.toString(), 340, y);
      doc.text(`₹ ${t.totalAmount}`, 420, y);
      y += 18;
    });

    if (!treatments.length) {
      doc.text("No treatment data available", 50, y);
      doc.end();
      return;
    }

    /* ===== SUMMARY (ONLY ABOVE TREATMENTS) ===== */

    y += 15;
    doc.moveTo(350, y).lineTo(555, y).stroke();
    y += 10;

    // calculate total ONLY for above treatments
    let visitTotal = 0;

    treatments.forEach(t => {
      const amount = Number(t.pricePerDay || 0) * Number(t.days || 0);
      visitTotal += amount;
    });

    const visitPaid = visitTotal;
    const visitDue = 0;
    // TOTAL
    doc.font("Helvetica");
    doc.text("Total Amount", 350, y);
    doc.text(`₹ ${visitTotal}`, 500, y, { align: "right" });
    // PAID
    y += 15;
    doc.text("Paid Amount", 350, y);
    doc.text(`₹ ${visitPaid}`, 500, y, { align: "right" });
    // DUE
    y += 15;
    doc.font("Helvetica-Bold");
    doc.text("Due Amount", 350, y);
    doc.text(`₹ ${visitDue}`, 500, y, { align: "right" });
    /* SIGN */
    doc.moveDown(4);
    doc.font("Helvetica").fontSize(13)
      .text("Authorized Signature", 420);

    doc.image(
      path.join(__dirname, "assets", "sign.png"),
      420,
      doc.y + 5,
      { width: 100 }
    );

    /* FOOTER */
    doc.y = doc.page.height - 110;
    doc.font("Helvetica-Bold").fontSize(14).text(
      "Thank you for choosing Sri Physiotherapy Center",
      40,
      doc.y,
      { width: doc.page.width - 80, align: "center" }
    );

    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(13).text(
      "Wishing you a speedy recovery",
      { width: doc.page.width - 80, align: "center" }
    );
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);
    doc.font("Helvetica").fontSize(13).text(
      "This is a Compuer Generated Invoice and does not require a physical signature.",
      { width: doc.page.width - 80, align: "center" }
    );
    doc.end();

  } catch (err) {
    console.error("INVOICE ERROR:", err);
    res.status(401).send("Invalid or expired token");
  }
});

/* ================= MONTHLY REPORT ================= */
app.get("/report/monthly/excel", auth, async (req, res) => {
  const { month, year } = req.query;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);

  const pts = await Patient.find({ createdAt: { $gte: start, $lte: end } });
  let total = 0, paid = 0;
  pts.forEach(p => { total += p.totalAmount; paid += p.paidAmount; });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Monthly Report", {
    pageSetup: { orientation: 'landscape' }
  });

  // Hospital-style header
  ws.mergeCells('A1', 'H1');
  ws.getCell('A1').value = 'Physio Clinic Monthly Report';
  ws.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getCell('A1').fill = {
    type: 'gradient', gradient: 'angle', degree: 0, stops: [
      { position: 0, color: { argb: 'FF0f766e' } },
      { position: 1, color: { argb: 'FF14b8a6' } }
    ]
  };

  ws.mergeCells('A2', 'H2');
  ws.getCell('A2').value = `Month: ${month}/${year}`;
  ws.getCell('A2').font = { size: 12, bold: true };
  ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };

  // Summary section
  ws.addRow([]);
  ws.addRow(['Total Patients', pts.length, '', 'Total Amount', total, '', 'Paid Amount', paid]);
  ws.addRow(['', '', '', 'Due Amount', total - paid]);
  ws.addRow([]);

  // Table header
  const headerRow = ws.addRow([
    'Patient Name', 'Age', 'Gender', 'Phone', 'Appointment Date', 'Total Amount', 'Paid Amount', 'Due Amount'
  ]);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0f766e' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Table body
  pts.forEach(p => {
    ws.addRow([
      p.name,
      p.age || '',
      p.gender || '',
      p.phone || '',
      p.appointmentDate ? new Date(p.appointmentDate).toLocaleDateString('en-IN') : '',
      p.totalAmount || 0,
      p.paidAmount || 0,
      (p.totalAmount || 0) - (p.paidAmount || 0)
    ]);
  });

  // Auto width for all columns
  ws.columns.forEach(col => {
    let max = 12;
    col.eachCell({ includeEmpty: true }, cell => {
      max = Math.max(max, (cell.value ? cell.value.toString().length : 0) + 2);
    });
    col.width = max;
  });

  // Add border to all cells
  ws.eachRow(row => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF14b8a6' } },
        left: { style: 'thin', color: { argb: 'FF14b8a6' } },
        bottom: { style: 'thin', color: { argb: 'FF14b8a6' } },
        right: { style: 'thin', color: { argb: 'FF14b8a6' } }
      };
    });
  });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=monthly_report_${month}_${year}.xlsx`
  );
  await wb.xlsx.write(res);
  res.end();
});

/* ================= DOCTOR MONTHLY EXCEL ================= */
app.get("/doctor/report/excel", auth, async (req, res) => {
  const { doctor, month, year } = req.query;
  if (!doctor || !month || !year) {
    return res.status(400).send("Doctor, month, and year are required");
  }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);

  // Get patients with appointment or treatments in this month
  const mStr = month.toString().padStart(2, '0');
  const monthPrefix = `${year}-${mStr}`;

  const allPts = await Patient.find({ recommendedDoctor: doctor });
  const pts = allPts.filter(p => {
    let isAppt = p.appointmentDate && p.appointmentDate.toISOString().startsWith(monthPrefix);
    let hasAtt = p.attendance && p.attendance.some(d => d.startsWith(monthPrefix));
    return isAppt || hasAtt;
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Doctor Monthly Report", {
    pageSetup: { orientation: 'portrait' }
  });

  // Main Header
  ws.mergeCells('A1', 'D1');
  ws.getCell('A1').value = `${doctor.toUpperCase()} SIR`;
  ws.getCell('A1').font = { name: 'Algerian', family: 2, size: 22, bold: true };
  ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };

  const monthName = new Date(0, parseInt(month) - 1).toLocaleString("default", { month: "long" }).toUpperCase();
  ws.mergeCells('A2', 'D2');
  ws.getCell('A2').value = `${monthName} MONTH ${year}`;
  ws.getCell('A2').font = { name: 'Algerian', family: 2, size: 16, bold: true };
  ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };

  ws.addRow([]);

  // Table header
  const headerRow = ws.addRow([
    'PHONE', 'PATIENT NAME', 'DAYS', 'COST/DAY', 'PAYMENT', 'REF FEE'
  ]);
  headerRow.font = { bold: true, size: 12 };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  headerRow.eachCell(cell => {
    cell.border = {
      top: { style: 'medium' }, left: { style: 'medium' },
      bottom: { style: 'medium' }, right: { style: 'medium' }
    };
  });

  // Table body
  let grandTotalFee = 0;
  let grandTotalRefFee = 0;

  pts.forEach(p => {
    let attendedDays = 0;
    if (p.attendance) {
      attendedDays = p.attendance.filter(d => d.startsWith(monthPrefix)).length;
    }

    let costPerDay = 0;
    if (p.treatmentHistory && p.treatmentHistory.length > 0) {
      const latest = p.treatmentHistory[p.treatmentHistory.length - 1];
      if (latest.treatments) {
        costPerDay = latest.treatments.reduce((sum, t) => sum + (t.pricePerDay || 0), 0);
      }
    }

    const totalPayment = costPerDay * attendedDays;
    const refFee = totalPayment * 0.30;

    grandTotalFee += totalPayment;
    grandTotalRefFee += refFee;

    const displayName = p.status === "Ongoing" ? `${p.name.toUpperCase()}\n(CONTINUE)` : p.name.toUpperCase();

    const row = ws.addRow([ p.phone || "-", displayName, attendedDays || "-", costPerDay || "-", totalPayment || "-", refFee.toFixed(2) || "-" ]);
      
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.font = { bold: true };
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'medium' }, left: { style: 'medium' },
        bottom: { style: 'medium' }, right: { style: 'medium' }
      };
    });
  });

  const totalsRow = ws.addRow([ "-", "MONTHLY SUMMARY", "-", "-", grandTotalFee, grandTotalRefFee.toFixed(2) ]);
  totalsRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  totalsRow.font = { bold: true, color: { argb: 'FF16a34a' } };
  totalsRow.eachCell(cell => {
    cell.border = {
      top: { style: 'medium' }, left: { style: 'medium' },
      bottom: { style: 'medium' }, right: { style: 'medium' }
    };
  });

  ws.getColumn(1).width = 15;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 15;
  ws.getColumn(4).width = 15;
  ws.getColumn(5).width = 15;
  ws.getColumn(6).width = 15;

  res.setHeader("Content-Disposition", `attachment; filename=doctor_report_${doctor}_${month}_${year}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

/* ================= DOCTOR MONTHLY PDF ================= */
app.get("/doctor/report/pdf", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).send("Token missing");
    jwt.verify(token, process.env.JWT_SECRET);

    const { doctor, month, year } = req.query;
    if (!doctor || !month || !year) {
      return res.status(400).send("Doctor, month, and year are required");
    }

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const mStr = month.toString().padStart(2, '0');
    const monthPrefix = `${year}-${mStr}`;

    const allPts = await Patient.find({ recommendedDoctor: doctor });
    const pts = allPts.filter(p => {
        let isAppt = p.appointmentDate && p.appointmentDate.toISOString().startsWith(monthPrefix);
        let hasAtt = p.attendance && p.attendance.some(d => d.startsWith(monthPrefix));
        return isAppt || hasAtt;
    });

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=doctor_report_${doctor}_${month}_${year}.pdf`);
    doc.pipe(res);

    /* LOGO HEADER */
    doc.image(path.join(__dirname, "assets", "logo.jpg"), 0, 0, { width: doc.page.width });
    doc.y = 280;
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);

    const monthName = new Date(0, parseInt(month) - 1).toLocaleString("default", { month: "long" }).toUpperCase();

    /* DOCTOR DETAILS BOX */
    doc.font("Helvetica-Bold").fontSize(14).text("Doctor Report Summary", 40);
    doc.moveDown(0.5);
    const boxY = doc.y;
    doc.roundedRect(40, boxY, 515, 60, 8).stroke();

    doc.font("Helvetica").fontSize(12);
    doc.text(`Doctor Name : Dr. ${doctor.toUpperCase()} SIR`, 55, boxY + 15);
    doc.text(`Report Period : ${monthName} ${year}`, 55, boxY + 35);

    doc.y = boxY + 85;

    /* TABLE HEADERS */
    const startY = doc.y;
    doc.font("Times-Bold").fontSize(11);

    doc.font("Times-Bold").fontSize(9);
    doc.text("PATIENT NAME", 40, startY, { width: 120, align: 'center' });
    doc.text("PHONE", 160, startY, { width: 80, align: 'center' });
    doc.text("DAYS", 240, startY, { width: 50, align: 'center' });
    doc.text("COST", 290, startY, { width: 70, align: 'center' });
    doc.text("PAYMENT", 360, startY, { width: 90, align: 'center' });
    doc.text("REF FEE(30%)", 450, startY, { width: 100, align: 'center' });

    // Header borders
    doc.rect(40, startY - 5, 120, 25).stroke();
    doc.rect(160, startY - 5, 80, 25).stroke();
    doc.rect(240, startY - 5, 50, 25).stroke();
    doc.rect(290, startY - 5, 70, 25).stroke();
    doc.rect(360, startY - 5, 90, 25).stroke();
    doc.rect(450, startY - 5, 100, 25).stroke();

    let y = startY + 25;
    let grandTotalFee = 0;
    let grandRefFee = 0;

    pts.forEach(p => {
      let attendedDays = 0;
      if (p.attendance) {
        attendedDays = p.attendance.filter(d => d.startsWith(monthPrefix)).length;
      }

      let costPerDay = 0;
      if (p.treatmentHistory && p.treatmentHistory.length > 0) {
        const latest = p.treatmentHistory[p.treatmentHistory.length - 1];
        if (latest.treatments) {
          costPerDay = latest.treatments.reduce((sum, t) => sum + (t.pricePerDay || 0), 0);
        }
      }

      const totalPayment = costPerDay * attendedDays;
      const refFee = totalPayment * 0.30;

      grandTotalFee += totalPayment;
      grandRefFee += refFee;

      const nameText = p.name.toUpperCase();
      const continueText = p.status === "Ongoing" ? "(CONT.)" : "";

      doc.rect(40, y - 5, 120, 35).stroke();
      doc.rect(160, y - 5, 80, 35).stroke();
      doc.rect(240, y - 5, 50, 35).stroke();
      doc.rect(290, y - 5, 70, 35).stroke();
      doc.rect(360, y - 5, 90, 35).stroke();
      doc.rect(450, y - 5, 100, 35).stroke();

      doc.font("Times-Roman").fontSize(9);
      doc.text(nameText, 42, y, { width: 116, align: 'center' });
      if (continueText) {
        doc.text(continueText, 42, y + 12, { width: 116, align: 'center' });
      }

      doc.text(p.phone || "-", 160, y + 6, { width: 80, align: 'center' });
      doc.text(attendedDays ? attendedDays.toString() : "-", 240, y + 6, { width: 50, align: 'center' });
      doc.text(costPerDay ? costPerDay.toString() : "-", 290, y + 6, { width: 70, align: 'center' });
      doc.text(totalPayment ? "Rs. " + totalPayment.toString() : "-", 360, y + 6, { width: 90, align: 'center' });
      doc.text(refFee ? "Rs. " + refFee.toFixed(2).toString() : "-", 450, y + 6, { width: 100, align: 'center' });

      y += 35;
      if (y > 650) {
        doc.addPage();
        y = 40;
      }
    });

    if (y === startY + 25) {
      doc.font("Times-Bold").fontSize(12);
      doc.text("NO PATIENTS FOUND FOR THIS PERIOD.", 40, y + 10, { align: 'center', width: 515 });
      y += 40;
    }

    // Grand Totals Summary
    y += 10;
    doc.moveTo(250, y).lineTo(550, y).stroke();
    y += 10;
    doc.font("Helvetica-Bold").fontSize(12);
    doc.text("Total Treatment Fees:", 250, y);
    doc.text(`Rs. ${grandTotalFee}`, 430, y, { align: 'center', width: 120 });
    y += 20;
    doc.text("Total Referral Fees:", 250, y);
    doc.text(`Rs. ${grandRefFee}`, 430, y, { align: 'center', width: 120 });

    /* SIGNATURE */
    y += 50;
    if (y > 700) { doc.addPage(); y = 40; }

    doc.font("Helvetica").fontSize(13).text("Authorized Signature", 410, y);
    doc.image(path.join(__dirname, "assets", "sign.png"), 420, y + 5, { width: 100 });

    /* FOOTER */
    doc.y = doc.page.height - 80;
    doc.font("Helvetica-Bold").fontSize(14).text(
      "Thank you for choosing Sri Physiotherapy Center",
      40, doc.y, { width: doc.page.width - 80, align: "center" }
    );
    doc.moveTo(40, doc.y + 20).lineTo(555, doc.y + 20).stroke();

    doc.end();

  } catch (err) {
    console.error("PDF ERROR:", err);
    res.status(500).send("Failed to generate PDF");
  }
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 5500;

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
