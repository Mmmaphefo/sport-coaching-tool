// lib/email sends invite emails through Resend. The Resend v6 SDK reports
// API-level rejections (test-mode recipient limits, unverified sender
// domain, invalid recipient) as `{ error }` on a RESOLVED promise instead of
// throwing — an earlier version of this lib ignored that field and reported
// "sent" for emails Resend had already refused. These tests pin the
// contract: only a clean send is `sent: true`, and every failure mode
// surfaces the provider's message so the UI can show the copy-link fallback
// with the real reason.
//
// The SDK's HTTP layer is not exercised: we stub globalThis.fetch and let
// the real Resend client run against it. That exercises the exact contract
// lib/email relies on — API-level rejections arrive as `{ error }` on a
// resolved promise, not as thrown exceptions — instead of simulating the
// SDK's internals.

const ORIGINAL_ENV = { ...process.env }

let fetchSpy

beforeEach(() => {
  vi.resetModules()
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
  process.env = { ...ORIGINAL_ENV }
})

function mockResendResponse(status, body) {
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

const inviteArgs = {
  to: 'assistant@example.com',
  role: 'assistant',
  inviteLink: 'https://kickstat.example/invite/abc123',
  squadName: 'Test Squad',
}

async function loadSendInviteEmail() {
  const mod = await import('../../src/lib/email')
  return mod.sendInviteEmail
}

describe('lib/email — sendInviteEmail', () => {
  test('reports a skipped send when RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY
    const sendInviteEmail = await loadSendInviteEmail()

    const result = await sendInviteEmail(inviteArgs)

    expect(result.sent).toBe(false)
    expect(result.error).toMatch(/RESEND_API_KEY/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('reports success only when Resend accepts the send', async () => {
    process.env.RESEND_API_KEY = 're_test_key'
    mockResendResponse(200, { id: 'email_1' })
    const sendInviteEmail = await loadSendInviteEmail()

    const result = await sendInviteEmail(inviteArgs)

    expect(result).toEqual({ sent: true })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('resend')
    const payload = JSON.parse(init.body)
    expect(payload).toEqual(
      expect.objectContaining({
        to: 'assistant@example.com',
        from: 'KickStat <onboarding@resend.dev>',
        subject: expect.stringContaining('Test Squad'),
      })
    )
  })

  test('honours EMAIL_FROM when set (verified-domain sender)', async () => {
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.EMAIL_FROM = 'KickStat <noreply@kickstat.example>'
    mockResendResponse(200, { id: 'email_2' })
    const sendInviteEmail = await loadSendInviteEmail()

    await sendInviteEmail({ ...inviteArgs, to: 'player@example.com', role: 'athlete' })

    const [, init] = fetchSpy.mock.calls[0]
    expect(JSON.parse(init.body).from).toBe('KickStat <noreply@kickstat.example>')
  })

  test('treats a provider rejection as a failed send and surfaces the message', async () => {
    process.env.RESEND_API_KEY = 're_test_key'
    // The exact failure Resend returns on a test-mode key sent to anyone
    // but the account owner — the production bug this fixes.
    mockResendResponse(403, {
      name: 'validation_error',
      message: 'You can only send testing emails to your own email address',
    })
    const sendInviteEmail = await loadSendInviteEmail()

    const result = await sendInviteEmail(inviteArgs)

    expect(result.sent).toBe(false)
    expect(result.error).toMatch(/testing emails/)
  })

  test('surfaces thrown transport errors as a failed send', async () => {
    process.env.RESEND_API_KEY = 're_test_key'
    fetchSpy.mockRejectedValue(new Error('fetch failed'))
    const sendInviteEmail = await loadSendInviteEmail()

    const result = await sendInviteEmail(inviteArgs)

    expect(result.sent).toBe(false)
    // The SDK wraps fetch rejections in its own message; any non-empty
    // detail is fine — the contract is sent:false plus a reason to show.
    expect(result.error).toMatch(/Unable to fetch data/)
  })
})
