import "../api/queries/connection";
// Add table imports and seed records here when launch content is approved.

async function seed() {
  console.log("No seed records configured. Add approved launch content before seeding.");
  process.exit(0); // close MySQL connection pool
}

seed();
