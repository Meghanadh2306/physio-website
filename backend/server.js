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
  origin: ["http://localhost:3000", "http://localhost:5500", "https://physio-website-nih7.onrender.com", "http://127.0.0.1:5500"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

    const visit = p.treatmentHistory.at(-1);
    if (!visit) {
      return res.status(400).json({ message: "No active visit found. Please add treatments first." });
    }

    const visitPaid = visit.paidAmount || 0;
    const visitDue  = visit.totalAmount - visitPaid;

    if (addPaid > visitDue) {
      return res.status(400).json({ message: "Payment exceeds due amount" });
    }

    visit.paidAmount = visitPaid + addPaid;
    p.paidAmount += addPaid;

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
}catch {
    res.status(500).json({ message: "Update failed" });
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
      
      const visit = p.treatmentHistory.at(-1);
      if (visit) {
        visit.paidAmount -= removedPayment.amount;
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
  await Patient.findByIdAndDelete(req.params.id);
  res.json({ message: "Patient deleted" });
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
  await Doctor.findByIdAndDelete(req.params.id);
  res.json({ message: "Doctor deleted" });
});

/* ================= PATIENT LIST ================= */
app.get("/patients", auth, async (req, res) => {
  const { search, status, doctor } = req.query;
  let filter = {};

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } }
    ];
  }
  if (status) filter.status = status;
  if (doctor) filter.recommendedDoctor = doctor;

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

    const beforeCount = patient.invoices.length;
    
    // Find invoice to get details
    const invoiceToDelete = patient.invoices.find(inv => inv.invoiceNumber === invoiceNumber);
    
    if (!invoiceToDelete) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Remove invoice
    patient.invoices = patient.invoices.filter(
      inv => inv.invoiceNumber !== invoiceNumber
    );

    // Delete related payments for this invoice based on dates
    if (patient.paymentHistory && patient.paymentHistory.length > 0) {
      const invoiceStartDate = new Date(invoiceToDelete.treatmentStartDate);
      const invoiceEndDate = new Date(invoiceToDelete.treatmentEndDate);
      
      let deletedPaymentAmount = 0;
      
      // Filter out payments that fall within this invoice's treatment period
      const originalPayments = patient.paymentHistory;
      patient.paymentHistory = patient.paymentHistory.filter(payment => {
        const paymentDate = new Date(payment.date);
        
        // If payment is within the invoice period and is a Payment entry, mark for deletion
        if (paymentDate >= invoiceStartDate && paymentDate <= invoiceEndDate && payment.entryType === "Payment") {
          deletedPaymentAmount += payment.amount || 0;
          return false; // Remove this payment
        }
        return true; // Keep this payment
      });
      
      // Adjust totals if payments were deleted
      if (deletedPaymentAmount > 0) {
        patient.paidAmount -= deletedPaymentAmount;
      }
    }

    // Recalculate status
    patient.status = patient.paidAmount >= patient.totalAmount ? "Completed" : "Ongoing";

    await patient.save();

    res.json({ message: "Invoice and related payments deleted successfully" });

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
  res.json(await Treatment.create(req.body));
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
res.setHeader("Content-Disposition",`attachment; filename=${patient.name}_invoice.pdf`);
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
doc.text(`Start Date: ${formatDateDMY(invoice?.treatmentStartDate)}`,55,boxY + 46);
doc.text(`End Date  : ${formatDateDMY(patient.endDate)}`, 55, boxY + 64);
doc.text(`Invoice No: ${invoice?.invoiceNumber || "-"}`,300,boxY + 64);

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

    let y = startY + 25;
    doc.font("Helvetica").fontSize(11);

    const lastVisit = patient.treatmentHistory.at(-1);
    lastVisit.treatments.forEach(t => {
      doc.text(t.treatmentName, 50, y);
      doc.text(`₹ ${t.pricePerDay}`, 250, y);
      doc.text(t.days.toString(), 340, y);
      doc.text(`₹ ${t.totalAmount}`, 420, y);
      y += 18;
    });
if (!lastVisit || !lastVisit.treatments?.length) {
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

if (lastVisit && lastVisit.treatments.length) {
  lastVisit.treatments.forEach(t => {
    const amount =
      Number(t.pricePerDay || 0) * Number(t.days || 0);
    visitTotal += amount;
  });
}
const visitPaid = visitTotal;   // ✅ FORCE FULL PAID
const visitDue  = Math.max(visitTotal - visitPaid, 0);
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
  const ws = wb.addWorksheet("Monthly Report");
  ws.addRows([
    ["Patients", pts.length],
    ["Total Amount", total],
    ["Paid Amount", paid],
    ["Due Amount", total - paid]
  ]);

res.setHeader(
  "Content-Disposition",
  `attachment; filename=monthly_report_${month}_${year}.xlsx`
);
  await wb.xlsx.write(res);
  res.end();
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 5500;

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
