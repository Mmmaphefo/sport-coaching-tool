// Seasons (T17). A named period per squad — "2026 Season", "Winter League" —
// that scopes the season totals/breakdowns and owns a generated schedule.
// Dates are plain days (inclusive); events link to a season via season_id,
// and deleting the season only untags them (the calendar keeps the matches).
exports.up = (pgm) => {
  pgm.createTable('seasons', {
    id: 'id',
    squad_id: {
      type: 'integer',
      notNull: true,
      references: 'squads',
      onDelete: 'CASCADE',
    },
    name: { type: 'varchar(100)', notNull: true },
    starts_on: { type: 'date', notNull: true },
    ends_on: { type: 'date', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('seasons', 'squad_id');

  // Set when the schedule generator (T23) creates the match, so a season's
  // own page can list its calendar without re-deriving it from dates.
  pgm.addColumns('events', {
    season_id: {
      type: 'integer',
      references: 'seasons',
      onDelete: 'SET NULL',
    },
  });

  pgm.createIndex('events', 'season_id');
};

exports.down = (pgm) => {
  pgm.dropColumns('events', ['season_id']);
  pgm.dropTable('seasons');
};
