export function formatDate(value?: string | Date | null) {
  if (!value) return "Not provided";
  if (value instanceof Date) return value.toLocaleDateString();
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
