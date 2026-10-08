// Injuries (T21): coach-recorded injury periods per athlete. An athlete counts
// as injured for lineup suggestions while "today" falls between started_on and
// COALESCE(expected_return, infinity).
exports.up = (pgm) => {
  pgm.createTable('athlete_injuries', {
    id: 'id',
    athlete_id: {
      type: 'integer',
      notNull: true,
      references: 'athletes',
      onDelete: 'CASCADE',
    },
    started_on: { type: 'date', notNull: true },
    expected_return: { type: 'date' },
    note: { type: 'varchar(255)' },
    // Coach can close an injury early without deleting the record
    cleared_at: { type: 'date' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('athlete_injuries', 'athlete_id');
};

exports.down = (pgm) => {
  pgm.dropTable('athlete_injuries');
};
