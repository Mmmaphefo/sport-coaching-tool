// Offline log metadata (T5/T9). A log can be queued on the touchline while
// the signal is down; by the time it replays, other actions may already be
// on the server. The create request therefore carries two extra fields:
//
//  - device_id: the device the action was logged on (varchar(64)). Kept for
//    provenance — which touchline device recorded this.
//  - occurred_at: the instant the action actually happened on the pitch.
//    The timeline orders by COALESCE(occurred_at, logged_at), so a queued
//    action replayed late still slots in where it happened instead of at
//    the end of its minute group (T9).
//
// Both are optional: a live request without them keeps the old behaviour
// (server insert time). Malformed values are rejected rather than silently
// dropped so a client bug surfaces during replay instead of corrupting the
// order.

const MAX_DEVICE_ID = 64;

function parseLogMeta(body) {
  let deviceId = null;
  if (body.device_id !== undefined && body.device_id !== null && body.device_id !== '') {
    deviceId = String(body.device_id).slice(0, MAX_DEVICE_ID);
  }

  let occurredAt = null;
  if (body.occurred_at !== undefined && body.occurred_at !== null && body.occurred_at !== '') {
    const parsed = new Date(body.occurred_at);
    if (Number.isNaN(parsed.getTime())) {
      return { error: 'occurred_at must be a valid date' };
    }
    occurredAt = parsed;
  }

  return { deviceId, occurredAt };
}

module.exports = { parseLogMeta };
