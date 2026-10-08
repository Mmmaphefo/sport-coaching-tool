exports.up = (pgm) => {
  pgm.createTable('injuries', {
    id: 'id',
    athlete_id: {
      type: 'integer',
      notNull: true,
      references: 'athletes',
      onDelete: 'CASCADE',
    },
    description: { type: 'text', notNull: true },
    date_sustained: { type: 'date', notNull: true },
    severity: { type: 'varchar(20)', notNull: true, default: 'moderate' },
    return_date: { type: 'date' },
    estimation_basis: { type: 'varchar(255)' },
    estimation_min_weeks: { type: 'integer' },
    estimation_max_weeks: { type: 'integer' },
    cleared_at: { type: 'timestamp' },
    logged_by: { type: 'integer', notNull: true, references: 'users' },
    created_at: { type: 'timestamp', default: pgm.func('now()') },
    updated_at: { type: 'timestamp', default: pgm.func('now()') },
  });

  pgm.addConstraint('injuries', 'injuries_severity_check', {
    check: "severity IN ('minor', 'moderate', 'severe')",
  });

  pgm.createIndex('injuries', 'athlete_id');
};

exports.down = (pgm) => {
  pgm.dropTable('injuries');
};