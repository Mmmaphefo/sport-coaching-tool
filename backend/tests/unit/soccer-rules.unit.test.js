import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// The rules module is CommonJS (module.exports), so load it through
// createRequire the same way the auth unit tests load the middleware.
const require = createRequire(import.meta.url);
const {
  MIN_DEBUT_AGE,
  dayKey,
  injuryDateError,
  matchDayViolation,
} = require('../../src/lib/soccerRules');

describe('soccer rules — match day calendar', () => {
  const clean = (existing) =>
    matchDayViolation({ newDay: '2026-10-10', existingDays: existing, playedDays: [] });

  it('allows a match on a free day', () => {
    expect(clean(['2026-10-01', '2026-10-05'])).toBeNull();
  });

  it('allows a second merely-scheduled match on the same day (advisory clash territory)', () => {
    expect(clean(['2026-10-10'])).toBeNull();
  });

  it('blocks a day whose match has already been played', () => {
    const violation = matchDayViolation({
      newDay: '2026-10-10',
      existingDays: ['2026-10-10'],
      playedDays: ['2026-10-10'],
    });
    expect(violation.code).toBe('match_already_played_today');
  });

  it('blocks a third consecutive match day running into the past', () => {
    expect(clean(['2026-10-08', '2026-10-09']).code).toBe('three_consecutive_days');
  });

  it('blocks a third consecutive match day running into the future', () => {
    expect(clean(['2026-10-11', '2026-10-12']).code).toBe('three_consecutive_days');
  });

  it('blocks bridging two match days into a three-day run', () => {
    expect(clean(['2026-10-09', '2026-10-11']).code).toBe('three_consecutive_days');
  });

  it('allows back-to-back match days (a two-day run is legal)', () => {
    expect(clean(['2026-10-09'])).toBeNull();
  });

  it('caps any seven-day window at five match days', () => {
    // Five matches already sit in the window; far enough from the new day
    // that the consecutive-day rule is not what trips — the recovery rule is.
    const violation = clean(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(violation.code).toBe('recovery_days');
  });

  it('still allows five match days spread across a week', () => {
    // Two-day run, gap, two-day run, gap — exactly five with two rest days.
    expect(clean(['2026-10-04', '2026-10-05', '2026-10-07', '2026-10-08'])).toBeNull();
  });

  it('ignores empty calendars and unparseable days', () => {
    expect(matchDayViolation({ newDay: null })).toBeNull();
    expect(clean([])).toBeNull();
  });

  it('normalises timestamps to day keys', () => {
    expect(dayKey('2026-10-10T18:00:00')).toBe('2026-10-10');
    expect(dayKey(null)).toBeNull();
  });
});

describe('soccer rules — injury dates', () => {
  it('accepts a normal adult injury date', () => {
    expect(injuryDateError({ dateOfBirth: '2000-05-01', dateSustained: '2026-10-10' })).toBeNull();
  });

  it('skips the check when the date of birth is unknown', () => {
    expect(injuryDateError({ dateOfBirth: null, dateSustained: '2026-10-10' })).toBeNull();
  });

  it('rejects an injury dated before the player was born', () => {
    const error = injuryDateError({ dateOfBirth: '2005-05-01', dateSustained: '2004-01-01' });
    expect(error).toMatch(/before the player was born/);
  });

  it(`rejects an injury before the player turns ${MIN_DEBUT_AGE}`, () => {
    const error = injuryDateError({ dateOfBirth: '2010-06-15', dateSustained: '2025-06-14' });
    expect(error).toMatch(/15 years old/);
  });

  it('allows an injury on the 15th birthday itself', () => {
    expect(injuryDateError({ dateOfBirth: '2010-06-15', dateSustained: '2025-06-15' })).toBeNull();
  });
});
