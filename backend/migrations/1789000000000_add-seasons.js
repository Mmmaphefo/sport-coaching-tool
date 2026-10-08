// Seasons (T17): a named date-range entity a squad can group its events under.
// Seasons are optional — events with season_id = NULL simply fall outside any
// season, and the stats routes still derive an Aug–May season label on the fly.
exports.up = (pgm) => {
  pgm.createTable('seasons', {
    id: 'id',
    squad_id: {
      type: 'integer',
      notNull: true,
      references: 'squads',
      onDelete: 'CASCADE',
    },
    name: { type: 'varchar(60)', notNull: true },
    start_date: { type: 'date', notNull: true },
    end_date: { type: 'date', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('seasons', 'squad_id');

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
  pgm.dropIndex('events', 'season_id');
  pgm.dropColumn('events', 'season_id');
  pgm.dropTable('seasons');
};
