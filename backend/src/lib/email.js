const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// The resend.dev senders only work in Resend's test mode, which delivers to
// the account owner's email address and nobody else — external invitees never
// receive anything from them. Production deployments should verify a domain
// in Resend and set EMAIL_FROM to an address on it (render.yaml documents
// the variable).
const DEFAULT_FROM = 'KickStat <onboarding@resend.dev>';

// `credentials` ({ email, password }) is set for player invites where the
// backend pre-created the account: the player needs the generated password
// to sign in for the first time, so it rides along in the same email.
//
// Returns { sent, error }. The Resend v6 SDK reports API-level rejections
// (test-mode recipient limits, unverified sender domain, invalid recipient)
// as `{ error }` on a RESOLVED promise — it does not throw. The old boolean
// return therefore reported "sent" for emails Resend had already refused,
// which is why coaches saw a success message while nothing was ever
// delivered. Only a clean send counts as sent.
async function sendInviteEmail({ to, role, inviteLink, squadName, credentials }) {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — invite email skipped. Link:', inviteLink);
    return { sent: false, error: 'RESEND_API_KEY is not configured' };
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

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject: `You've been invited to join ${squadName} on KickStat`,
      html: `
        <p>You've been invited to join <strong>${squadName}</strong> as ${roleLabel} on KickStat.</p>
        ${credentialsHtml}
        <p><a href="${inviteLink}">Accept your invite</a></p>
        <p>Or paste this link into your browser:<br>${inviteLink}</p>
      `,
    });

    if (error) {
      console.error(`Resend rejected the invite email to ${to}:`, error.message || error);
      return { sent: false, error: error.message || 'Email provider rejected the send' };
    }

    return { sent: true };
  } catch (err) {
    console.error('Failed to send invite email:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendInviteEmail };
