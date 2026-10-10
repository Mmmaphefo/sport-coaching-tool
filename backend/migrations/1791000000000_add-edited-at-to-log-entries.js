exports.up = (pgm) => {
  // Last-writer-wins editing (T12): the moment this entry was last edited on
  // the server. Timestamptz, not timestamp: clients compare their queued
  // edits' instants against this value, so it must round-trip as an absolute
  // point in time. NULL means "never edited" — create does not set it, so a
  // client holding an offline copy can tell whether its version is stale.
  pgm.addColumn('log_entries', {
    edited_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('log_entries', 'edited_at');
};
