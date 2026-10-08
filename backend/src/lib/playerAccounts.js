const crypto = require('crypto');

// Passwords generated for player accounts. Length and character classes are
// chosen to satisfy Clerk's default "at least 8 characters, include a number,
// an uppercase and a lowercase letter, and a special character" rule.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function pickRandom(chars, count) {
  const bytes = crypto.randomBytes(count);
  let out = '';
  for (let i = 0; i < count; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function generatePassword() {
  // One of each required class first so the complexity rule always passes,
  // then fill the rest from the full alphabet and shuffle.
  const chars = [
    pickRandom(UPPER, 1),
    pickRandom(LOWER, 1),
    pickRandom(DIGITS, 1),
    pickRandom(SYMBOLS, 1),
    pickRandom(ALL, 10),
  ].join('').split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Split an athlete display name into first/last for Clerk. Falls back to
// the whole name as first name when there is only one word.
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Player', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

// Creates the Clerk account for an invited player so the coach can hand them
// login details alongside the invite link. Never throws: a failure here
// (Clerk unreachable, email already registered, …) must not block the invite
// itself — the player can still sign up via the link. The caller decides what
// to show based on the returned shape:
//   { created: true, email, password }
//   { created: false, reason: 'exists'|'error', email }
// In the test environment there is no Clerk, so a password is generated and
// returned as if the account had been created.
async function createPlayerAccount({ email, name }) {
  const password = generatePassword();
  const { firstName, lastName } = splitName(name);

  if (process.env.NODE_ENV === 'test') {
    return { created: true, email, password };
  }

  try {
    const { clerkClient } = require('@clerk/express');
    await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      firstName,
      ...(lastName ? { lastName } : {}),
    });
    return { created: true, email, password };
  } catch (err) {
    const status = err?.status || err?.statusCode;
    if (status === 422 || /already|exists|duplicate/i.test(err?.message || '')) {
      return { created: false, reason: 'exists', email };
    }
    console.error('Failed to create player account:', err?.message || err);
    return { created: false, reason: 'error', email };
  }
}

module.exports = { generatePassword, createPlayerAccount };
