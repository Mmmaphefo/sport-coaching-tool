// Lineups are captured before live logging can begin. Each row places one
// athlete on the pitch (starters, with drag-and-drop coordinates) or on the
// bench for a fixture or a simple event. Exactly one of fixture_id /
// event_id must be set — simple events only ever carry the coach's own
// (home) side, since their opponent is a free-text name with no roster.
exports.up = (pgm) => {
  pgm.createTable('match_lineups', {
    id: 'id',
    fixture_id: {
      type: 'integer',
      references: 'fixtures',
      onDelete: 'CASCADE',
    },
    event_id: {
      type: 'integer',
      references: 'events',
      onDelete: 'CASCADE',
    },
    athlete_id: {
      type: 'integer',
      notNull: true,
      references: 'athletes',
      onDelete: 'CASCADE',
    },
    // 'home' | 'away'
    team_side: { type: 'varchar(8)', notNull: true },
    // Pitch position as percentages (0-100), null while benched.
    pos_x: { type: 'smallint' },
    pos_y: { type: 'smallint' },
    is_starter: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('match_lineups', 'match_lineups_one_owner', {
    check: '(fixture_id IS NOT NULL) != (event_id IS NOT NULL)',
  });
  pgm.addConstraint('match_lineups', 'match_lineups_team_side_check', {
    check: "team_side IN ('home', 'away')",
  });

  pgm.createIndex('match_lineups', 'fixture_id');
  pgm.createIndex('match_lineups', 'event_id');
  pgm.createIndex('match_lineups', 'athlete_id');
};

exports.down = (pgm) => {
  pgm.dropTable('match_lineups');
};
