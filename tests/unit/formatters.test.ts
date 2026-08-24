import { describe, it, expect } from 'vitest';
import {
  formatEur,
  formatEurAxis,
  formatEurCompactAxis,
  toPercent,
  formatPercentValue,
  toDayLabel,
  toMonthLabel,
  formatSince,
  formatAbsoluteDateTime,
} from '../../src/shared/formatters.js';

const expectedEur = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
  }).format(value);

const expectedMonth = (value: string): string =>
  new Date(value).toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });

const expectedDay = (value: string): string =>
  new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const expectedRelative = (value: number, unit: Intl.RelativeTimeFormatUnit): string =>
  new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);

const expectedAbsolute = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

describe('formatEur', () => {
  it('formats a positive value as EUR', () => {
    expect(formatEur(1234.56)).toBe(expectedEur(1234.56));
  });

  it('formats zero', () => {
    expect(formatEur(0)).toBe(expectedEur(0));
  });

  it('formats a negative value', () => {
    expect(formatEur(-42.5)).toBe(expectedEur(-42.5));
  });

  it('returns masked value in privacy mode', () => {
    expect(formatEur(1234.56, true)).toBe('****,** €');
  });
});

describe('formatEurAxis', () => {
  it('rounds to integer and adds € suffix', () => {
    expect(formatEurAxis(1234.56)).toBe('1235 €');
  });

  it('returns masked value in privacy mode', () => {
    expect(formatEurAxis(1234.56, true)).toBe('****,** €');
  });
});

describe('formatEurCompactAxis', () => {
  it('divides by 1000 and rounds', () => {
    expect(formatEurCompactAxis(12500)).toBe('13k');
  });

  it('handles small values', () => {
    expect(formatEurCompactAxis(500)).toBe('1k');
  });

  it('returns masked value in privacy mode', () => {
    expect(formatEurCompactAxis(12500, true)).toBe('****,** €');
  });
});

describe('toPercent', () => {
  it('converts decimal to percentage string', () => {
    expect(toPercent(0.0852)).toBe('8.52%');
  });

  it('handles zero', () => {
    expect(toPercent(0)).toBe('0.00%');
  });

  it('handles negative values', () => {
    expect(toPercent(-0.05)).toBe('-5.00%');
  });

  it('returns masked value in privacy mode', () => {
    expect(toPercent(0.0852, true)).toBe('**%');
  });
});

describe('formatPercentValue', () => {
  it('formats raw percentage value with 2 decimals', () => {
    expect(formatPercentValue(8.523)).toBe('8.52%');
  });

  it('returns masked value in privacy mode', () => {
    expect(formatPercentValue(8.523, true)).toBe('**%');
  });
});

describe('toMonthLabel', () => {
  it('converts ISO date to short month + 2-digit year', () => {
    expect(toMonthLabel('2026-03-15')).toBe(expectedMonth('2026-03-15'));
  });

  it('returns input string for invalid date', () => {
    expect(toMonthLabel('not-a-date')).toBe('not-a-date');
  });

  it('keeps a month-only calendar key in the requested month', () => {
    expect(toMonthLabel('2026-03')).toBe(expectedMonth('2026-03'));
  });
});

describe('toDayLabel', () => {
  it('converts an ISO date to a short day and month label', () => {
    expect(toDayLabel('2026-07-12')).toBe(expectedDay('2026-07-12'));
  });

  it('returns the input string for an invalid date', () => {
    expect(toDayLabel('not-a-date')).toBe('not-a-date');
  });
});

describe('formatSince', () => {
  it('formats recent timestamp as relative time', () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(formatSince(past)).toBe(expectedRelative(-1, 'hour'));
  });

  it('handles invalid date', () => {
    expect(formatSince('not-a-date')).toBe('—');
  });
});

describe('formatAbsoluteDateTime', () => {
  it('formats ISO date to locale absolute datetime', () => {
    const timestamp = '2026-03-09T11:00:00.000Z';
    expect(formatAbsoluteDateTime(timestamp)).toBe(expectedAbsolute(timestamp));
  });

  it('returns input string for invalid date', () => {
    expect(formatAbsoluteDateTime('not-a-date')).toBe('not-a-date');
  });
});
