const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// `credentials` ({ email, password }) is set for player invites where the
// backend pre-created the account: the player needs the generated password
// to sign in for the first time, so it rides along in the same email.
async function sendInviteEmail({ to, role, inviteLink, squadName, credentials }) {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — invite email skipped. Link:', inviteLink);
    return false;
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
    await resend.emails.send({
      from: 'KickStat <onboarding@resend.dev>',
      to,
      subject: `You've been invited to join ${squadName} on KickStat`,
      html: `
        <p>You've been invited to join <strong>${squadName}</strong> as ${roleLabel} on KickStat.</p>
        ${credentialsHtml}
        <p><a href="${inviteLink}">Accept your invite</a></p>
        <p>Or paste this link into your browser:<br>${inviteLink}</p>
      `,
    });
    return true;
  } catch (err) {
    console.error('Failed to send invite email:', err.message);
    return false;
  }
}

module.exports = { sendInviteEmail };
