export function getTodayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function isFutureDate(dateStr: string): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  return dateStr > getTodayISO();
}

export function validateNotFutureDate(dateStr: string, fieldName = "Date"): string | null {
  if (isFutureDate(dateStr)) {
    return `${fieldName} cannot be in the future. Today is ${getTodayISO()}.`;
  }
  return null;
}
