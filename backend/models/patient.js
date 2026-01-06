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

  appointmentDate: String,
endDate: String,   // ✅ MANUAL END DATE


  treatmentHistory: [
    {
      date: { type: Date, default: Date.now },
          startDate: String,   // ✅ ADD
    endDate: String,     // ✅ ADD
      treatments: [
        {
          treatmentName: String,
          pricePerDay: Number,
          days: Number,
          totalAmount: Number
        }
      ],
      totalAmount: Number
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
