// Anchors the live clock at the moment an event/fixture actually goes live,
// instead of deriving elapsed time from the scheduled kickoff.
exports.up = (pgm) => {
  pgm.addColumns('events', {
    started_at: {
      type: 'timestamptz',
    },
  });
  pgm.addColumns('fixtures', {
    started_at: {
      type: 'timestamptz',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('events', ['started_at']);
  pgm.dropColumns('fixtures', ['started_at']);
};
