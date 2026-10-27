import { describe, expect, it } from 'vitest';
import { unobservableExpectation } from '../src/index.ts';

describe('unobservableExpectation', () => {
  it.each([
    'The message "Invalid email or password" is shown',
    'HTTP 423 with code ACCOUNT_LOCKED',
    'The Save button is disabled',
    'Còn lại 21 buổi',
    'The user is redirected to /dashboard',
    // Absences, relations and named states: the false flags measured on the Gym CRM session drafts.
    'No edit action is offered',
    'No reminder task exists',
    'The channel field is marked required and nothing is saved',
    'The approval matrix shows receipts as not requiring approval',
    'The unit price on the form equals the new tier price',
    'The approval task goes to Admin, not to the Fitness Manager',
    'The lead becomes a customer with the same ID',
    'Closing balance = opening + receipts - expenses, to the đồng',
    "The approver's direct manager receives a notice",
    'The option is marked inactive',
    'The new note is saved',
  ])('accepts an observable result: %s', (text) => {
    expect(unobservableExpectation(text)).toBeNull();
  });

  it.each([
    ['An error is shown', 'no exact message, value or state'],
    ['The page loads correctly', 'leaves the judgement to the tester'],
    ['The list refreshes quickly and shows 3 rows', 'the word "quickly"'],
    ['It works', 'the word "works"'],
    ['   ', 'empty'],
    // Still unverifiable: a value or a thing is named without saying which.
    ['Both totals are shown', 'no exact message, value or state'],
    ['The tier list shows the new unit price', 'no exact message, value or state'],
    ['The report is displayed', 'no exact message, value or state'],
  ])('flags an unverifiable result: %s', (text, reason) => {
    expect(unobservableExpectation(text)).toContain(reason);
  });
});
