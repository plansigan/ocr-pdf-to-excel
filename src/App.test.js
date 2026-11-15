import { parseReceipt } from './utils/helper';

describe('parseReceipt', () => {
  test('extracts branch sheet regardless of line position and parses key-value pairs', () => {
    const sample = [
      'HEADER',
      'SM CITY CLARK',
      'Date Issued: 01/15/2025',
      'Cash Sales: 1,234.50',
    ].join('\n');

    const result = parseReceipt(sample);
    expect(result.sheet).toBe('CLARK');
    expect(result.dateIssued).toBe('01/15/2025');
    expect(result.cashSales).toBe('1,234.50');
  });

  test('does not throw when branch is missing or text is short', () => {
    const result = parseReceipt('Short text without branch');
    expect(result.sheet).toBeUndefined();
  });
});
