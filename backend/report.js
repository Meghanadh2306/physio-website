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

    const patients = await Patient.find({
      recommendedDoctor: doctor,
      appointmentDate: {
        $regex: `^${year}-${month.padStart(2, "0")}`
      }
    });

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
        doc.font("Helvetica-Bold")
          .fontSize(14)
          .text(`${i + 1}. ${p.name} | ${p.phone} | ${p.gender || "-"}`);

        doc.font("Helvetica")
          .fontSize(14)
          .text(`Problem: ${p.problem || "-"}`, { indent: 20 });

        doc.text(
          `Appointment: ${p.appointmentDate}`,
          { indent: 20 }
        );

        doc.moveDown(0.8);
      });
    }

    doc.end();

  } catch (err) {
    console.error("DOCTOR PDF ERROR:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

module.exports = router;
