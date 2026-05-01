const express = require("express");
const PDFDocument = require("pdfkit");
const path = require("path");
const Patient = require("./models/patient");

const router = express.Router();

router.get("/doctor-pdf", async (req, res) => {
  try {
    const { doctor, month, year } = req.query;

    if (!doctor || !month || !year) {
      return res.status(400).json({ message: "Doctor, Month, Year required" });
    }

    const targetPrefix = `${year}-${month.padStart(2, "0")}`;
    const allPatients = await Patient.find({ recommendedDoctor: doctor });

    const patients = allPatients.filter(p => {
      // Case-insensitive trimmed comparison for doctor name
      const pDoc = (p.recommendedDoctor || "").trim().toLowerCase();
      const sDoc = (doctor || "").trim().toLowerCase();
      if (pDoc !== sDoc) return false;

      let isAppt = false;
      if (p.appointmentDate) {
        const ad = new Date(p.appointmentDate);
        isAppt = ad.getFullYear() === parseInt(year) && (ad.getMonth() + 1) === parseInt(month);
      }
      let hasAtt = p.attendance && p.attendance.some(d => {
        const parts = d.split("-");
        return parts[0] === year && parseInt(parts[1]) === parseInt(month);
      });
      let hasPay = p.paymentHistory && p.paymentHistory.some(ph => {
        if (!ph.date) return false;
        if (ph.entryType && ph.entryType.toLowerCase() !== "payment") return false;
        const d = new Date(ph.date);
        return d.getFullYear() === parseInt(year) && (d.getMonth() + 1) === parseInt(month);
      });
      let hasTreat = p.treatmentHistory && p.treatmentHistory.some(th => {
        if (!th.date) return false;
        const d = new Date(th.date);
        return d.getFullYear() === parseInt(year) && (d.getMonth() + 1) === parseInt(month);
      });
      return isAppt || hasAtt || hasPay || hasTreat;
    });

    let totalMonthlyPayment = 0;
    let totalMonthlyRefFee = 0;

    // FORCE DOWNLOAD
    res.setHeader("Content-Type", "application/pdf");
res.setHeader(
  "Content-Disposition",
  `attachment; filename=${doctor}_${month}_${year}.pdf`
);


    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    // HEADER IMAGE
    doc.image(
      path.join(__dirname, "assets", "logo.jpg"),
      0,
      0,
      { width: doc.page.width }
    );

    doc.y = 300;

    doc.font("Helvetica-Bold")
    doc.moveDown(1.5);
    doc.fontSize(15);
    doc.text(`Doctor: ${doctor}`);
    doc.text(`Month / Year: ${month} / ${year}`);

    doc.moveDown(1);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);

    if (!patients.length) {
      doc.text("No patients found for this period.", { align: "center" });
    } else {
      patients.forEach((p, i) => {
        let attendedDays = 0;
        if (p.attendance) {
          attendedDays = p.attendance.filter(d => {
            const parts = d.split("-");
            return parts[0] === year && parseInt(parts[1]) === parseInt(month);
          }).length;
        }

        let totalPayment = 0;
        if (p.paymentHistory) {
          totalPayment = p.paymentHistory
            .filter(ph => {
              if (!ph.date) return false;
              if (ph.entryType && ph.entryType.toLowerCase() !== "payment") return false;
              const d = new Date(ph.date);
              return d.getFullYear() === parseInt(year) && (d.getMonth() + 1) === parseInt(month);
            })
            .reduce((sum, ph) => sum + Number(ph.amount || 0), 0);
        }
        const refFee = totalPayment * 0.30;

        totalMonthlyPayment += totalPayment;
        totalMonthlyRefFee += refFee;

        doc.font("Helvetica-Bold")
          .fontSize(14)
          .text(`${i + 1}. ${p.name} | ${p.phone} | Days: ${attendedDays}`);

        doc.font("Helvetica")
          .fontSize(12)
          .text(`Total Payment: Rs.${totalPayment} | Ref Fee (30%): Rs.${refFee.toFixed(2)}`, { indent: 20 });
        doc.moveDown(0.8);
      });

      doc.moveDown(1);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(1);

      doc.font("Helvetica-Bold").fontSize(14);
      doc.text(`Monthly Total Payment: Rs.${totalMonthlyPayment}`);
      doc.text(`Monthly Reference Fee: Rs.${totalMonthlyRefFee.toFixed(2)}`);
    }

    doc.end();

  } catch (err) {
    console.error("DOCTOR PDF ERROR:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

module.exports = router;
