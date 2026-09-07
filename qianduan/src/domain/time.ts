/** API timestamps are UTC; SQLite's driver can serialize them without an offset. */
export function serverTime(value: string): Date {
  return new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
}
