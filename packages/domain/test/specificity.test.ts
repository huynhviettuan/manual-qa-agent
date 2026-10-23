import { describe, expect, it } from 'vitest';
import { unobservableExpectation } from '../src/index.ts';

describe('unobservableExpectation', () => {
  it.each([
    'The message "Invalid email or password" is shown',
    'HTTP 423 with code ACCOUNT_LOCKED',
    'The Save button is disabled',
    'Còn lại 21 buổi',
    'The user is redirected to /dashboard',
  ])('accepts an observable result: %s', (text) => {
    expect(unobservableExpectation(text)).toBeNull();
  });

  it.each([
    ['An error is shown', 'no exact message, value or state'],
    ['The page loads correctly', 'leaves the judgement to the tester'],
    ['The list refreshes quickly and shows 3 rows', 'the word "quickly"'],
    ['It works', 'the word "works"'],
    ['   ', 'empty'],
  ])('flags an unverifiable result: %s', (text, reason) => {
    expect(unobservableExpectation(text)).toContain(reason);
  });
});
