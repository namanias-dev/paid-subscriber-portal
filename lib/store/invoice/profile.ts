/** Shared tax profile for physical printed UPSC subject notes. Products opt in; nothing inherits it silently. */
export const PRINTED_NOTES_TAX_PROFILE = {
  name: "Printed UPSC Subject Notes",
  hsn: "49011010",
  taxTreatment: "nil",
  taxRateBps: 0,
  unit: "BOOKS",
  status: "CONFIRMED",
  source: "CA",
} as const;
