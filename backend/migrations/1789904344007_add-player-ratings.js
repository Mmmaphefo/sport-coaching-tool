// Cache of EA/FIFA-style player ratings used by the match simulator.
// The simulator needs an "overall" per player to weight the odds of the
// simulated 90 minutes. Ratings are pulled once per player name from an
// external player dataset and kept here so the external API is only ever
// asked for a name that was never looked up before — `source` records where
// the number came from ('dataset' hit vs 'estimated' positional fallback),
// and `checked_at` lets estimated rows be revisited later while real dataset
// hits stay cached forever.
exports.up = (pgm) => {
  pgm.createTable('player_ratings', {
    id: 'id',
    name_normalized: { type: 'varchar(160)', notNull: true, unique: true },
    display_name: { type: 'varchar(160)' },
    overall: { type: 'smallint', notNull: true },
    position: { type: 'varchar(40)' },
    // 'dataset' | 'estimated'
    source: { type: 'varchar(16)', notNull: true, default: 'estimated' },
    checked_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('player_ratings', 'player_ratings_overall_range', {
    check: 'overall BETWEEN 1 AND 99',
  });
  pgm.addConstraint('player_ratings', 'player_ratings_source_check', {
    check: "source IN ('dataset', 'estimated')",
  });
};

exports.down = (pgm) => {
  pgm.dropTable('player_ratings');
};
