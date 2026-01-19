const mongoose = require("mongoose");
require("dotenv").config();

async function fixIndex() {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("✅ Connected to MongoDB");

    // Drop the problematic unique index
    await mongoose.connection.collection("patients").dropIndex("invoices.invoiceNumber_1");
    console.log("✅ Dropped invoices.invoiceNumber_1 index");

    await mongoose.disconnect();
    console.log("✅ Done!");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

fixIndex();
