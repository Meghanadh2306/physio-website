const mongoose = require("mongoose");

const PatientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: Number,
  gender: String,
  address: String,
  phone: String,

  appointmentDate: String,
  treatments: [String],
  problem: String,
  notes: String,
  recommendedDoctor: String,

  // Past Years Details
  pastMedicalHistory: String,
  previousTreatments: String,
  allergiesAndMeds: String,

  treatmentHistory: [
    {
      date: { type: Date, default: Date.now },
      startDate: String,
      endDate: String,
      treatments: [
        {
          treatmentName: String,
          pricePerDay: Number,
          days: Number,
          totalAmount: Number
        }
      ],
      totalAmount: Number,
      paidAmount: Number
    }
  ],

  totalAmount: { type: Number, default: 0 },
  paidAmount: { type: Number, default: 0 },
invoices: [
  {
    invoiceNumber: String,
    treatmentStartDate: String,
    treatmentEndDate: String,
    totalAmount: Number,
    paidAmount: Number,
    dueAmount: Number,
    createdAt: Date
  }
],
  paymentHistory: [
    {
      entryType: String,
      amount: Number,
      date: { type: Date, default: Date.now }
    }
  ],

  status: { type: String, default: "Ongoing" },
  createdAt: { type: Date, default: Date.now }
  
});

module.exports = mongoose.model("Patient", PatientSchema);
