import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/index.ts';

describe('redactSecrets', () => {
  it.each([
    ['Authorization: Bearer abc.def-123', 'abc.def-123'],
    ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here', 'eyJhbGciOiJIUzI1NiJ9'],
    ['key sk-test_1234567890abcdefXYZ', 'sk-test_1234567890abcdefXYZ'],
    ['Cookie: session=abcdef; other=1', 'session=abcdef'],
    ['password: hunter2', 'hunter2'],
    ['api_key="fake-key-value"', 'fake-key-value'],
    ['contact jane.doe@example.com', 'jane.doe@example.com'],
    ['AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
  ])('removes the secret from %j', (input, secret) => {
    const { text, redactions } = redactSecrets(input);
    expect(text).not.toContain(secret);
    expect(redactions).toBeGreaterThan(0);
  });

  it('keeps the field name so context is preserved', () => {
    expect(redactSecrets('password: hunter2').text).toBe('password: [REDACTED]');
  });

  it('leaves ordinary requirement text untouched', () => {
    const text = 'AC-LOGIN-04: after 5 failed attempts the account is locked for 15 minutes.';
    expect(redactSecrets(text)).toEqual({ text, redactions: 0 });
  });
});
