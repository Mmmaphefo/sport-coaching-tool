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
    status: { type: 'varchar(20)', notNull: true, default: 'pending' },
    note: { type: 'text' },
    responded_by: { type: 'integer', references: 'users' },
    responded_at: { type: 'timestamp' },
    created_at: { type: 'timestamp', default: pgm.func('now()') },
    updated_at: { type: 'timestamp', default: pgm.func('now()') },
  });

  pgm.addConstraint('event_rsvps', 'event_rsvps_status_check', {
    check: "status IN ('pending', 'available', 'unavailable', 'maybe')",
  });

  // One RSVP row per athlete per event.
  pgm.addConstraint('event_rsvps', 'event_rsvps_event_athlete_unique', {
    unique: ['event_id', 'athlete_id'],
  });

  pgm.createIndex('event_rsvps', 'event_id');
  pgm.createIndex('event_rsvps', 'athlete_id');
};

exports.down = (pgm) => {
  pgm.dropTable('event_rsvps');
};
