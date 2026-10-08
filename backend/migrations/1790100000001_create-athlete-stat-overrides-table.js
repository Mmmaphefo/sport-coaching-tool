exports.up = (pgm) => {
  pgm.createTable('athlete_stat_overrides', {
    id: 'id',
    athlete_id: {
      type: 'integer',
      notNull: true,
      references: 'athletes',
      onDelete: 'CASCADE',
    },
    // e.g. 'goals', 'assists', 'penalties', 'yellowCards', 'redCards', 'appearances'
    stat_key: { type: 'varchar(40)', notNull: true },
    override_value: { type: 'integer', notNull: true },
    note: { type: 'text' },
    set_by: { type: 'integer', notNull: true, references: 'users' },
    created_at: { type: 'timestamp', default: pgm.func('now()') },
    updated_at: { type: 'timestamp', default: pgm.func('now()') },
  });

  // Only one active override per stat, per athlete — setting it again
  // updates the existing row instead of stacking corrections.
  pgm.addConstraint('athlete_stat_overrides', 'athlete_stat_overrides_athlete_stat_unique', {
    unique: ['athlete_id', 'stat_key'],
  });

  pgm.createIndex('athlete_stat_overrides', 'athlete_id');
};

exports.down = (pgm) => {
  pgm.dropTable('athlete_stat_overrides');
};
