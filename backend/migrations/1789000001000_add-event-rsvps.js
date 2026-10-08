// RSVPs (T21): per-athlete availability for a specific event, set by the coach
// (or reported by athletes later). status is one of 'yes' | 'no' | 'maybe'.
exports.up = (pgm) => {
  pgm.createTable('event_rsvps', {
    id: 'id',
    event_id: {
      type: 'integer',
      notNull: true,
      references: 'events',
      onDelete: 'CASCADE',
    },
    athlete_id: {
      type: 'integer',
      notNull: true,
      references: 'athletes',
      onDelete: 'CASCADE',
    },
    status: { type: 'varchar(10)', notNull: true, default: 'maybe' },
    note: { type: 'varchar(255)' },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('event_rsvps', 'event_id');
  pgm.createIndex('event_rsvps', 'athlete_id');
  // One availability per athlete per event
  pgm.addConstraint('event_rsvps', 'event_rsvps_event_athlete_unique', {
    unique: ['event_id', 'athlete_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('event_rsvps');
};
