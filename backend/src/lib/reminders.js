// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
const { clerkClient } = require('@clerk/express');
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const HOURS_BEFORE = 24;

async function getCoachEmail(pool, userId) {
  if (process.env.NODE_ENV === 'test') {
    return process.env.TEST_COACH_EMAIL || 'coach@example.com';
  }

  try {
    const userResult = await pool.query('SELECT clerk_id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) return null;

    const clerkUser = await clerkClient.users.getUser(userResult.rows[0].clerk_id);
    return clerkUser.primaryEmailAddress?.emailAddress || null;
  } catch (err) {
    console.error('Failed to fetch coach email:', err.message);
    return null;
  }
}

async function sendEventReminders(pool) {
  try {
    const now = new Date();
    const window = new Date(now.getTime() + HOURS_BEFORE * 60 * 60 * 1000);

    const result = await pool.query(
      `SELECT e.*, s.name AS squad_name, u.id AS coach_user_id
       FROM events e
       JOIN squads s ON s.id = e.squad_id
       JOIN users u ON u.id = e.created_by
       WHERE e.status = 'scheduled'
         AND e.event_date > $1
         AND e.event_date <= $2
         AND e.reminder_sent = false`,
      [now, window]
    );

    for (const event of result.rows) {
      const to = await getCoachEmail(pool, event.coach_user_id);
      if (!to) {
        console.warn(`No email found for coach of event ${event.id}; skipping reminder.`);
        continue;
      }

      if (!resend) {
        console.warn(
          `RESEND_API_KEY not set — reminder email skipped for event ${event.id}. Coach: ${to}`
        );
        // In tests we still mark the reminder as sent so the scheduling logic
        // is exercisable without a real email provider.
        if (process.env.NODE_ENV === 'test') {
          await pool.query('UPDATE events SET reminder_sent = true WHERE id = $1', [event.id]);
        }
        continue;
      }

      try {
        const eventDate = new Date(event.event_date).toLocaleString();
        const eventTitle = event.title || event.opponent || 'Upcoming event';

        const { error } = await resend.emails.send({
          from: process.env.EMAIL_FROM || 'KickStat <reminders@resend.dev>',
          to,
          subject: `Reminder: ${eventTitle} is coming up`,
          html: `
            <p>Hi coach,</p>
            <p>This is a reminder that <strong>${eventTitle}</strong> is scheduled for <strong>${eventDate}</strong>.</p>
            <p>Squad: ${event.squad_name}</p>
            <p><a href="${process.env.FRONTEND_URL}/events/${event.id}">View event details</a></p>
          `,
        });

        if (error) {
          // Resend returns API-level rejections (unverified/sandbox sender
          // domain, invalid recipient, etc.) as `{ error }` in the response
          // rather than throwing — without this check, a rejected send fell
          // through to the success branch below and was marked as sent.
          console.error(`Resend rejected the reminder for event ${event.id}:`, error.message || error);
          continue;
        }

        await pool.query('UPDATE events SET reminder_sent = true WHERE id = $1', [event.id]);
        console.log(`Reminder sent for event ${event.id} to ${to}`);
      } catch (err) {
        console.error(`Failed to send reminder for event ${event.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Reminder sweep failed:', err.message);
  }
}

module.exports = { sendEventReminders, HOURS_BEFORE };
