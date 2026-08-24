const MASKED_EUR_VALUE = '****,** €';
const MASKED_PERCENT_VALUE = '**%';

export function formatEur(value: number, privacyMode?: boolean): string {
  if (privacyMode) return MASKED_EUR_VALUE;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

export function formatEurAxis(value: number, privacyMode?: boolean): string {
  if (privacyMode) return MASKED_EUR_VALUE;
  return `${Math.round(value)} €`;
}

export function formatEurCompactAxis(value: number, privacyMode?: boolean): string {
  if (privacyMode) return MASKED_EUR_VALUE;
  return `${Math.round(value / 1000)}k`;
}

export function toPercent(value: number, privacyMode?: boolean): string {
  if (privacyMode) return MASKED_PERCENT_VALUE;
  return `${(value * 100).toFixed(2)}%`;
}

export function formatPercentValue(value: number, privacyMode?: boolean): string {
  if (privacyMode) return MASKED_PERCENT_VALUE;
  return `${value.toFixed(2)}%`;
}

export function toMonthLabel(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

export function toDayLabel(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const ABSOLUTE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatSince(timestamp: string): string {
  const targetTime = new Date(timestamp).getTime();
  if (Number.isNaN(targetTime)) return '—';

  const diffSeconds = Math.round((targetTime - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  const steps: Array<{ limit: number; unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
    { limit: 60, unit: 'second', seconds: 1 },
    { limit: 3600, unit: 'minute', seconds: 60 },
    { limit: 86400, unit: 'hour', seconds: 3600 },
    { limit: 604800, unit: 'day', seconds: 86400 },
    { limit: 2629800, unit: 'week', seconds: 604800 },
    { limit: 31557600, unit: 'month', seconds: 2629800 },
    { limit: Number.POSITIVE_INFINITY, unit: 'year', seconds: 31557600 },
  ];

  const step = steps.find((s) => absSeconds < s.limit) || steps[steps.length - 1]!;
  const value = Math.trunc(diffSeconds / step.seconds) || (diffSeconds > 0 ? 1 : -1);

  return RELATIVE_FORMATTER.format(value, step.unit);
}

export function formatAbsoluteDateTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return ABSOLUTE_FORMATTER.format(parsed);
}
