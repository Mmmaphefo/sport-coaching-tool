// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Invite and reminder emails with a fake Resend, a fake Clerk and a fake
// database pool, so every path (sent, rejected, failed, no address) is
// tested without sending real email. Both modules create their Resend client
// at load time, so each test reloads them with the environment it needs.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const paths = {
  email: require.resolve('../../src/lib/email.js'),
  reminders: require.resolve('../../src/lib/reminders.js'),
  resend: require.resolve('resend'),
  clerk: require.resolve('@clerk/express'),
}

let send
let getUser
let saved

function load(which, { apiKey = 're_test' } = {}) {
  if (apiKey) process.env.RESEND_API_KEY = apiKey
  else delete process.env.RESEND_API_KEY
  const fake = (exports) => ({ loaded: true, exports })
  require.cache[paths.resend] = fake({ Resend: class { constructor() { this.emails = { send } } } })
  require.cache[paths.clerk] = fake({ clerkClient: { users: { getUser } } })
  // reminders.js sends through email.js, so both are reloaded together.
  delete require.cache[paths.email]
  delete require.cache[paths.reminders]
  return require(paths[which])
}

// A fake pg pool that answers the three queries reminders.js makes.
function fakePool({ events = [], users = { 1: 'user_clerk_1' }, failSweep = false } = {}) {
  const updates = []
  return {
    updates,
    query: vi.fn(async (sql, params) => {
      if (/FROM events e/.test(sql)) {
        if (failSweep) throw new Error('db down')
        return { rows: events }
      }
      if (/SELECT clerk_id FROM users/.test(sql)) {
        const id = users[params[0]]
        return { rows: id ? [{ clerk_id: id }] : [] }
      }
      if (/UPDATE events SET reminder_sent/.test(sql)) {
        updates.push(params[0])
        return { rows: [] }
      }
      throw new Error(`unexpected query: ${sql}`)
    }),
  }
}

const event = (id, extra = {}) => ({
  id, title: `Match ${id}`, event_date: new Date(Date.now() + 3600e3), squad_name: 'Wits FC', coach_user_id: 1, ...extra,
})

beforeEach(() => {
  saved = { ...process.env }
  saved.cache = { resend: require.cache[paths.resend], clerk: require.cache[paths.clerk] }
  process.env.NODE_ENV = 'production'
  process.env.FRONTEND_URL = 'https://kickstat.pages.dev'
  send = vi.fn(async () => ({ data: { id: 'msg_1' }, error: null }))
  getUser = vi.fn(async () => ({ primaryEmailAddress: { emailAddress: 'coach@wits.ac.za' } }))
  for (const m of ['log', 'warn', 'error']) vi.spyOn(console, m).mockImplementation(() => {})
})

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  for (const [k, v] of Object.entries(saved)) if (k !== 'cache') process.env[k] = v
  for (const k of ['resend', 'clerk']) {
    if (saved.cache[k]) require.cache[paths[k]] = saved.cache[k]
    else delete require.cache[paths[k]]
  }
  delete require.cache[paths.email]
  delete require.cache[paths.reminders]
  vi.restoreAllMocks()
})

describe('sendInviteEmail', () => {
  test('sends an assistant invite with the link', async () => {
    const { sendInviteEmail } = load('email')
    const result = await sendInviteEmail({ to: 'a@b.c', role: 'assistant', inviteLink: 'https://x/invite/t1', squadName: 'Wits FC' })
    expect(result).toEqual({ sent: true })
    const msg = send.mock.calls[0][0]
    expect(msg.to).toBe('a@b.c')
    expect(msg.subject).toContain('Wits FC')
    expect(msg.html).toContain('an assistant coach')
    expect(msg.html).not.toContain('Password')
  })

  test("includes a player's generated sign-in details", async () => {
    const { sendInviteEmail } = load('email')
    await sendInviteEmail({
      to: 'p@b.c', role: 'athlete', inviteLink: 'https://x/invite/t2', squadName: 'Wits FC',
      credentials: { email: 'p@b.c', password: 'Temp-123' },
    })
    expect(send.mock.calls[0][0].html).toContain('Temp-123')
  })

  test('reports failure instead of throwing when sending fails', async () => {
    send.mockRejectedValue(new Error('network'))
    const { sendInviteEmail } = load('email')
    expect(await sendInviteEmail({ to: 'a@b.c', role: 'assistant', inviteLink: 'l', squadName: 's' }))
      .toEqual({ sent: false, error: 'network' })
  })

  test('treats a provider rejection as not sent', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'You can only send testing emails to your own email address (owner@example.com)' } })
    const { sendInviteEmail } = load('email')
    const result = await sendInviteEmail({ to: 'a@b.c', role: 'assistant', inviteLink: 'l', squadName: 's' })
    expect(result.sent).toBe(false)
  })

  test('skips sending when no email provider is configured', async () => {
    const { sendInviteEmail } = load('email', { apiKey: null })
    expect((await sendInviteEmail({ to: 'a@b.c', role: 'assistant', inviteLink: 'l', squadName: 's' })).sent).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('publicEmailError (what the browser is told)', () => {
  test('never repeats the provider message, which can contain the account owner email', () => {
    const { publicEmailError } = load('email')
    const raw = 'You can only send testing emails to your own email address (owner@example.com). Please verify a domain at resend.com/domains'
    const safe = publicEmailError(raw)
    expect(safe).toBe('Email can only be sent to outside addresses once a sending domain is set up.')
    expect(safe).not.toMatch(/@|resend/i)
  })

  test('explains a missing configuration, a generic failure, and success', () => {
    const { publicEmailError } = load('email')
    expect(publicEmailError('RESEND_API_KEY is not configured')).toBe('Email sending is not set up on the server yet.')
    expect(publicEmailError('socket hang up')).toBe('The email service could not send this invite right now.')
    expect(publicEmailError(null)).toBeNull()
  })
})

describe('sendEventReminders', () => {
  test("emails the coach and marks the event as reminded", async () => {
    const { sendEventReminders } = load('reminders')
    const pool = fakePool({ events: [event(7)] })
    await sendEventReminders(pool)
    expect(getUser).toHaveBeenCalledWith('user_clerk_1')
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'coach@wits.ac.za', subject: 'Reminder: Match 7 is coming up' })
    expect(send.mock.calls[0][0].html).toContain('https://kickstat.pages.dev/events/7')
    expect(pool.updates).toEqual([7])
  })

  test('does not mark an event when the provider rejects the email', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'unverified domain' } })
    const { sendEventReminders } = load('reminders')
    const pool = fakePool({ events: [event(8)] })
    await sendEventReminders(pool)
    expect(pool.updates).toEqual([])
  })

  test('keeps going after one email throws', async () => {
    send.mockRejectedValueOnce(new Error('timeout'))
    const { sendEventReminders } = load('reminders')
    const pool = fakePool({ events: [event(9), event(10, { title: null, opponent: 'Rovers' })] })
    await sendEventReminders(pool)
    expect(pool.updates).toEqual([10])
    expect(send.mock.calls[1][0].subject).toBe('Reminder: Rovers is coming up')
  })

  test('skips an event whose coach has no email address', async () => {
    getUser.mockResolvedValue({ primaryEmailAddress: null })
    const { sendEventReminders } = load('reminders')
    const pool = fakePool({ events: [event(11), event(12, { coach_user_id: 99 })] })
    await sendEventReminders(pool)
    expect(send).not.toHaveBeenCalled()
    expect(pool.updates).toEqual([])
  })

  test('skips an event when Clerk cannot be reached', async () => {
    getUser.mockRejectedValue(new Error('clerk down'))
    const { sendEventReminders } = load('reminders')
    const pool = fakePool({ events: [event(13)] })
    await sendEventReminders(pool)
    expect(pool.updates).toEqual([])
  })

  test('leaves events unmarked in production when no provider is configured', async () => {
    const { sendEventReminders } = load('reminders', { apiKey: null })
    const pool = fakePool({ events: [event(14)] })
    await sendEventReminders(pool)
    expect(send).not.toHaveBeenCalled()
    expect(pool.updates).toEqual([])
  })

  test('survives a failed database sweep', async () => {
    const { sendEventReminders } = load('reminders')
    await expect(sendEventReminders(fakePool({ failSweep: true }))).resolves.toBeUndefined()
  })
})

describe('Brevo (used when BREVO_API_KEY is set)', () => {
  let fetchMock
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'xkeysib-test'
    process.env.EMAIL_FROM = 'KickStat Team <kickstat.team@gmail.com>'
    fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ messageId: '<1@brevo>' }) }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('sends an invite through Brevo, from the verified sender, instead of Resend', async () => {
    const { sendInviteEmail } = load('email')
    const result = await sendInviteEmail({ to: 'a@b.c', role: 'assistant', inviteLink: 'https://x/invite/t1', squadName: 'Wits FC' })
    expect(result).toEqual({ sent: true })
    expect(send).not.toHaveBeenCalled()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.headers['api-key']).toBe('xkeysib-test')
    const body = JSON.parse(init.body)
    expect(body.sender).toEqual({ name: 'KickStat Team', email: 'kickstat.team@gmail.com' })
    expect(body.to).toEqual([{ email: 'a@b.c' }])
    expect(body.subject).toContain('Wits FC')
    expect(body.htmlContent).toContain('https://x/invite/t1')
  })

  test('accepts a bare sender address', async () => {
    process.env.EMAIL_FROM = 'kickstat.team@gmail.com'
    const { sendEmail } = load('email')
    await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sender).toEqual({ name: 'KickStat', email: 'kickstat.team@gmail.com' })
  })

  test('reports a Brevo rejection without throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 'invalid_parameter', message: 'Sender is not valid' }) })
    const { sendInviteEmail, publicEmailError } = load('email')
    const result = await sendInviteEmail({ to: 'a@b.c', role: 'assistant', inviteLink: 'l', squadName: 's' })
    expect(result).toEqual({ sent: false, error: 'Sender is not valid' })
    expect(publicEmailError(result.error)).toBe('The email service could not send this invite right now.')
  })

  test('falls back to the status code when Brevo returns no message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => { throw new Error('not json') } })
    const { sendEmail } = load('email')
    expect(await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).toEqual({ sent: false, error: 'Brevo returned status 401' })
  })

  test('reports a network failure and a timeout', async () => {
    const { sendEmail } = load('email')
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).toEqual({ sent: false, error: 'fetch failed' })
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    expect(await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).toEqual({ sent: false, error: 'Brevo did not respond in time' })
  })

  test('needs EMAIL_FROM (the verified sender)', async () => {
    delete process.env.EMAIL_FROM
    const { sendEmail, publicEmailError } = load('email')
    const result = await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })
    expect(result.sent).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(publicEmailError(result.error)).toBe('Email sending is not set up on the server yet.')
  })

  test('sends reminders through Brevo too, and only marks delivered ones', async () => {
    const { sendEventReminders } = load('reminders', { apiKey: null })
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'rejected' }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) })
    const pool = fakePool({ events: [event(21), event(22)] })
    await sendEventReminders(pool)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).subject).toBe('Reminder: Match 22 is coming up')
    expect(pool.updates).toEqual([22])
  })

  test('with no provider at all, nothing is sent and the reason says so', async () => {
    delete process.env.BREVO_API_KEY
    const { sendEmail, publicEmailError } = load('email', { apiKey: null })
    const result = await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })
    expect(result.sent).toBe(false)
    expect(result.error).toMatch(/RESEND_API_KEY/)
    expect(publicEmailError(result.error)).toBe('Email sending is not set up on the server yet.')
  })
})

