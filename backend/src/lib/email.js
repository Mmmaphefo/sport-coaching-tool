const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// The resend.dev senders only work in Resend's test mode, which delivers to
// the account owner's email address and nobody else — external invitees never
// receive anything from them. Production deployments should verify a domain
// in Resend and set EMAIL_FROM to an address on it (render.yaml documents
// the variable).
const DEFAULT_FROM = 'KickStat <onboarding@resend.dev>';

// ---- Providers -------------------------------------------------------------
// Brevo is used when BREVO_API_KEY is set; otherwise Resend (RESEND_API_KEY).
// Brevo's free plan sends to any recipient once a single sender address is
// verified (no domain needed), which Resend's test mode does not allow.
// Either way, EMAIL_FROM is the sender, e.g. "KickStat <team@gmail.com>"; for
// Brevo it must be the address verified in the Brevo dashboard.
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 10000;

// "KickStat <team@gmail.com>" -> { name: 'KickStat', email: 'team@gmail.com' }
function parseSender(from) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from || '');
  if (match) return { name: match[1] || 'KickStat', email: match[2].trim() };
  return { name: 'KickStat', email: String(from || '').trim() };
}

async function sendViaBrevo({ to, subject, html }) {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    return { sent: false, error: 'EMAIL_FROM is not configured (it must be your verified Brevo sender)' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ sender: parseSender(from), to: [{ email: to }], subject, htmlContent: html }),
      signal: controller.signal,
    });
  } catch (err) {
    return { sent: false, error: err.name === 'AbortError' ? 'Brevo did not respond in time' : err.message };
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { sent: false, error: body.message || `Brevo returned status ${res.status}` };
  }
  return { sent: true };
}

// The Resend v6 SDK reports API-level rejections (test-mode recipient limits,
// unverified sender domain, invalid recipient) as `{ error }` on a RESOLVED
// promise — it does not throw — so only a clean send counts as sent.
async function sendViaResend({ to, subject, html }) {
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject,
      html,
    });
    if (error) return { sent: false, error: error.message || 'Email provider rejected the send' };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

function emailConfigured() {
  return Boolean(process.env.BREVO_API_KEY || resend);
}

// Sends one email through whichever provider is configured.
// Returns { sent: true } or { sent: false, error } and never throws.
async function sendEmail({ to, subject, html }) {
  if (process.env.BREVO_API_KEY) return sendViaBrevo({ to, subject, html });
  if (resend) return sendViaResend({ to, subject, html });
  return { sent: false, error: 'No email provider is configured (set BREVO_API_KEY or RESEND_API_KEY)' };
}

// ---- Invites ------------------------------------------------------------------
// `credentials` ({ email, password }) is set for player invites where the
// backend pre-created the account: the player needs the generated password
// to sign in for the first time, so it rides along in the same email.
async function sendInviteEmail({ to, role, inviteLink, squadName, credentials }) {
  if (!emailConfigured()) {
    console.warn('No email provider configured (BREVO_API_KEY / RESEND_API_KEY) — invite email skipped. Link:', inviteLink);
    return { sent: false, error: 'No email provider is configured (set BREVO_API_KEY or RESEND_API_KEY)' };
  }

  const roleLabel = role === 'athlete' ? 'an athlete' : 'an assistant coach';

  let credentialsHtml = '';
  if (role === 'athlete' && credentials && credentials.password) {
    credentialsHtml = `
      <p>Your account has been created for you. Sign in with:</p>
      <p>
        Email: <strong>${credentials.email}</strong><br>
        Password: <strong>${credentials.password}</strong>
      </p>
      <p>Use the button below to accept your invite — you can change your password any time from Account settings.</p>
    `;
  }

  const result = await sendEmail({
    to,
    subject: `You've been invited to join ${squadName} on KickStat`,
    html: `
        <p>You've been invited to join <strong>${squadName}</strong> as ${roleLabel} on KickStat.</p>
        ${credentialsHtml}
        <p><a href="${inviteLink}">Accept your invite</a></p>
        <p>Or paste this link into your browser:<br>${inviteLink}</p>
      `,
  });
  if (!result.sent) console.error(`Invite email to ${to} was not sent:`, result.error);
  return result;
}

// What the browser may be told about a failed send. The provider's own
// message stays in the server log only: Resend's test-mode rejection, for
// example, contains the Resend account owner's personal email address, and
// it was being shown to every coach who sent an invite.
function publicEmailError(error) {
  if (!error) return null;
  const text = String(error);
  if (/not configured|no email provider/i.test(text)) {
    return 'Email sending is not set up on the server yet.';
  }
  if (/testing emails|verify a domain|domain is not verified|not verified/i.test(text)) {
    return 'Email can only be sent to outside addresses once a sending domain is set up.';
  }
  return 'The email service could not send this invite right now.';
}

module.exports = { sendEmail, emailConfigured, sendInviteEmail, publicEmailError };
