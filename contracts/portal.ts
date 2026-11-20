export const SERVICE_AREAS = [
  { state: "FL", counties: ["Miami-Dade", "Broward", "Palm Beach"] },
  { state: "CA", counties: ["San Diego", "Orange", "Riverside", "Los Angeles", "San Bernardino"] },
] as const;

export const DOCUMENT_CATEGORIES = [
  { value: "court", label: "Court summons or complaint", folder: "Court Summons and Complaints" },
  { value: "pleading", label: "Pleading, motion, or order", folder: "Court Pleadings and Orders" },
  { value: "service", label: "Proof of service", folder: "Proof of Service" },
  { value: "statement", label: "Periodic billing statement", folder: "Periodic Billing Statements" },
  { value: "credit", label: "Credit report or dispute", folder: "Credit Reports and Disputes" },
  { value: "collection", label: "Collection letter or email", folder: "Debt Collection Communications" },
  { value: "repossession", label: "Repossession document", folder: "Repossession" },
  { value: "billing_error", label: "Billing-error correspondence", folder: "Billing Error Correspondence" },
  { value: "payment", label: "Payment or account history", folder: "Payment Records" },
  { value: "other", label: "Other important document", folder: "Documents Pending Review" },
] as const;

export const SERVICE_INTERESTS = [
  "Debt-collection lawsuit",
  "Credit-card billing error",
  "Credit-report review",
  "Repossession",
  "General financial education",
] as const;

export const BRAND = {
  name: "Reputation Tenability",
  tagline: "Financial intervention. Restoration. Forward motion.",
  email: "val@reputation-tenability.com",
  phone: "310-614-1037",
  website: "www.reputation-tenability.com",
} as const;
