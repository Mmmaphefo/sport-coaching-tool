// Shared edit semantics for log entries (T12). The event and the fixture
// routers edit the same table, so validation, change detection, the
// last-writer-wins guard and the update itself live here once.
//
// Editing contract:
//  - Present-flag fields: sending a key changes it (an explicit null clears
//    the nullable ones); omitting it leaves the stored value untouched.
//  - A real change stamps edited_at — the newest accepted write. A queued
//    edit replayed with an older client_edited_at loses to the stored
//    version (last-writer-wins): the row is returned as-is with
//    applied: false instead of clobbering newer data.
//
// Callers resolve the event/fixture, the role guard and the (not deleted)
// row first, then map this outcome to a response.

function normalise(body) {
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  const fields = {};

  if (has('athlete_id')) {
    if (body.athlete_id === null || body.athlete_id === '') {
      fields.athlete_id = null; // null = the opponent's action
    } else {
      const athleteId = Number(body.athlete_id);
      if (!Number.isInteger(athleteId)) return { error: 'athlete_id must be a number or null' };
      fields.athlete_id = athleteId;
    }
  }
  if (has('action_type')) {
    const actionType = typeof body.action_type === 'string' ? body.action_type.trim() : '';
    if (!actionType) return { error: 'action_type cannot be empty' };
    fields.action_type = actionType;
  }
  if (has('is_scoring')) {
    fields.is_scoring = Boolean(body.is_scoring);
  }
  if (has('value')) {
    if (body.value === null) return { error: 'value cannot be cleared' };
    const value = Number(body.value);
    if (!Number.isFinite(value)) return { error: 'value must be a number' };
    fields.value = Math.trunc(value);
  }
  if (has('minute')) {
    if (body.minute === null || body.minute === '') {
      fields.minute = null;
    } else {
      const minute = Number(body.minute);
      if (!Number.isFinite(minute) || minute < 0 || minute > 120) {
        return { error: 'Minute must be between 0 and 120' };
      }
      fields.minute = minute;
    }
  }
  if (has('notes')) {
    const notes =
      body.notes === null || body.notes === undefined || body.notes === ''
        ? null
        : String(body.notes);
    if (notes !== null && notes.length > 255) {
      return { error: 'notes must be 255 characters or fewer' };
    }
    fields.notes = notes;
  }

  return { fields };
}

function valueChanged(key, current, next) {
  if (key === 'is_scoring') return Boolean(current) !== Boolean(next);
  if (key === 'value' || key === 'minute') {
    if (current === null || next === null) return current !== next;
    return Number(current) !== Number(next);
  }
  return (current ?? null) !== (next ?? null);
}

async function applyLogEdit(pool, { row, body, squadId }) {
  const { fields, error } = normalise(body);
  if (error) return { status: 400, error };

  // A present athlete_id must be one of the squad's players — an edit must
  // never silently attach a log to another squad's athlete.
  if (fields.athlete_id) {
    const athlete = await pool.query(
      'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
      [fields.athlete_id, squadId]
    );
    if (athlete.rows.length === 0) {
      return { status: 400, error: 'Athlete does not belong to this squad' };
    }
  }

  // Last-writer-wins: the stored edited_at is the newest accepted write.
  // A replayed queued edit older than it is superseded, not applied.
  const parsedClientEditedAt = body.client_edited_at ? new Date(body.client_edited_at) : null;
  const clientEditedAt =
    parsedClientEditedAt && !Number.isNaN(parsedClientEditedAt.getTime())
      ? parsedClientEditedAt
      : null;
  if (
    clientEditedAt &&
    row.edited_at &&
    clientEditedAt.getTime() < new Date(row.edited_at).getTime()
  ) {
    return { status: 200, entry: { ...row, applied: false } };
  }

  const changedKeys = Object.keys(fields).filter((key) => valueChanged(key, row[key], fields[key]));
  if (changedKeys.length === 0) {
    // Nothing was sent, or nothing actually changed: no edit stamp, but a
    // successful no-op response so replayed edits don't error.
    return { status: 200, entry: row };
  }

  const sets = [];
  const params = [];
  for (const key of changedKeys) {
    params.push(fields[key]);
    sets.push(`${key} = $${params.length}`);
  }
  // edited_at carries the edit's logical time: a client-supplied one is
  // clamped to the server clock (least) so a fast client clock cannot
  // shadow every later edit, while a replayed backlog still keeps its
  // order against other queued edits. No client time means a live edit —
  // stamped with the server's now().
  if (clientEditedAt) {
    params.push(clientEditedAt);
    sets.push(`edited_at = least(now(), $${params.length})`);
  } else {
    sets.push('edited_at = now()');
  }
  params.push(row.id);
  const result = await pool.query(
    `UPDATE log_entries
     SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING *`,
    params
  );
  if (result.rows.length === 0) {
    // Deleted between the caller's read and this update.
    return { status: 410, error: 'Log entry has been deleted' };
  }
  return { status: 200, entry: result.rows[0] };
}

module.exports = { applyLogEdit };
