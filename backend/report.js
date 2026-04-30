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
      let isAppt = p.appointmentDate && new Date(p.appointmentDate).toISOString().startsWith(targetPrefix);
      let hasAtt = p.attendance && p.attendance.some(d => d.startsWith(targetPrefix));
      return isAppt || hasAtt;
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
          attendedDays = p.attendance.filter(d => d.startsWith(targetPrefix)).length;
        }

        const totalPayment = p.paidAmount || 0;
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
