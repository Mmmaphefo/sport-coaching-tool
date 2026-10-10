// Friendlies (T24). A match proposed to another squad from the public
// directory: the proposing coach picks a kickoff and venue, the challenged
// coach accepts or declines, and acceptance lands the SAME match on both
// calendars — one event per squad, linked back to this row.
exports.up = (pgm) => {
  pgm.createTable('friendlies', {
    id: 'id',
    proposing_squad_id: {
      type: 'integer',
      notNull: true,
      references: 'squads',
      onDelete: 'CASCADE',
    },
    opposing_squad_id: {
      type: 'integer',
      notNull: true,
      references: 'squads',
      onDelete: 'CASCADE',
    },
    event_date: { type: 'timestamp', notNull: true },
    location: { type: 'varchar(255)' },
    message: { type: 'text' },
    // 'proposed' | 'accepted' | 'declined' | 'cancelled'
    status: { type: 'varchar(20)', notNull: true, default: 'proposed' },
    decline_reason: { type: 'text' },
    decided_at: { type: 'timestamp' },
    // Set when accepted — each squad's copy of the match on its calendar.
    proposing_event_id: {
      type: 'integer',
      references: 'events',
      onDelete: 'SET NULL',
    },
    opposing_event_id: {
      type: 'integer',
      references: 'events',
      onDelete: 'SET NULL',
    },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('friendlies', 'proposing_squad_id');
  pgm.createIndex('friendlies', 'opposing_squad_id');
};

exports.down = (pgm) => {
  pgm.dropTable('friendlies');
};
