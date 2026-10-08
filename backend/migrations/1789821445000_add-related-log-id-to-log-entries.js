// Links an assist log entry to the goal it set up. The timeline renders
// "Goal — Scorer (assist: Name)" from this, and undoing the goal soft-deletes
// its linked assist entries along with it.
exports.up = (pgm) => {
  pgm.addColumns('log_entries', {
    related_log_id: {
      type: 'integer',
      references: 'log_entries',
      onDelete: 'SET NULL',
    },
  });

  pgm.createIndex('log_entries', 'related_log_id');
};

exports.down = (pgm) => {
  pgm.dropColumns('log_entries', ['related_log_id']);
};
