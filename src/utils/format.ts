const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export function formatDuration(ms: number): string {
  if (ms < 0) {
    throw new RangeError("Duration must be non-negative");
  }

  if (ms >= MS_PER_HOUR) {
    const hours = Math.floor(ms / MS_PER_HOUR);
    const remainingAfterHours = ms % MS_PER_HOUR;
    const minutes = Math.floor(remainingAfterHours / MS_PER_MINUTE);
    return `${hours}h ${minutes}m`;
  }

  if (ms >= MS_PER_MINUTE) {
    const minutes = Math.floor(ms / MS_PER_MINUTE);
    const seconds = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);
    return `${minutes}m ${seconds}s`;
  }

  const seconds = ms / MS_PER_SECOND;
  const formatted = seconds % 1 === 0 ? seconds.toString() : seconds.toString();
  return `${formatted}s`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCost(cents: number): string {
  if (cents < 0) {
    throw new RangeError("Cost must be non-negative");
  }
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}
