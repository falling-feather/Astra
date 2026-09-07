export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDate(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfWeek(date: Date, offset = 0): Date {
  const result = addDays(date, -((date.getDay() + 6) % 7) + offset * 7);
  result.setHours(12, 0, 0, 0);
  return result;
}

export function monthCells(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
  const offset = (first.getDay() + 6) % 7;
  const length = Math.ceil((offset + last.getDate()) / 7) * 7;
  return Array.from({ length }, (_, i) => addDays(first, i - offset));
}

export function moveMonth(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1, 12);
}

export const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function dayLabel(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[(date.getDay() + 6) % 7]}`;
}
