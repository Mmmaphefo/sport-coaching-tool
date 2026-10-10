exports.up = (pgm) => {
  // Offline log metadata (T5/T9).
  //
  // device_id: the touchline device a log was created on — kept so a coach
  // can tell which device recorded an action when several are in use.
  //
  // occurred_at: the instant the action actually happened on the pitch.
  // Offline-queued logs reach the server late (possibly after newer actions),
  // so the timeline orders by COALESCE(occurred_at, logged_at) — a replayed
  // action lands where it happened, while live rows keep using logged_at.
  // timestamptz so client-sent instants compare and sort as absolute times.
  pgm.addColumns('log_entries', {
    device_id: { type: 'varchar(64)' },
    occurred_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('log_entries', ['device_id', 'occurred_at']);
};
