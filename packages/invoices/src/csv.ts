/** One cell of a semicolon-separated spreadsheet file: a leading formula character is neutralised so spreadsheets never run it. */
export function csvCell(v: string | number): string {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
