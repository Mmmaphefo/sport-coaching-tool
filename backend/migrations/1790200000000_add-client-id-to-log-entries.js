exports.up = (pgm) => {
  // Client-generated id for log entries created through the offline queue.
  // Logging happens pitch-side with a weak signal; the frontend queues
  // entries locally and replays them on reconnect. A replayed request whose
  // original response was lost on a flaky connection must not create a
  // second row, so the server uses this id to recognise an entry it has
  // already stored. Nullable — entries logged online never set it.
  pgm.addColumn('log_entries', {
    client_id: { type: 'varchar(64)' },
  });

  // Partial unique index: enforces idempotency per client-generated id while
  // leaving every legacy/online row (client_id IS NULL) unconstrained.
  pgm.createIndex('log_entries', 'client_id', {
    unique: true,
    where: 'client_id IS NOT NULL',
    name: 'log_entries_client_id_unique',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('log_entries', 'client_id', { name: 'log_entries_client_id_unique' });
  pgm.dropColumn('log_entries', 'client_id');
};
