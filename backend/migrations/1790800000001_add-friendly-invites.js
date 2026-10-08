// Friendlies (T24): a proposal from one squad's coach to another squad's coach
// to arrange a one-off match. On acceptance a pair of mirror match events is
// created (one per squad, each seeing the other as the opponent) and their ids
// are stored so both sides can navigate to the same fixture.
exports.up = (pgm) => {
  pgm.createTable('friendly_invites', {
    id: 'id',
    from_squad_id: {
      type: 'integer',
      notNull: true,
      references: 'squads',
      onDelete: 'CASCADE',
    },
    to_squad_id: {
      type: 'integer',
      notNull: true,
      references: 'squads',
      onDelete: 'CASCADE',
    },
    proposed_by: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    proposed_date: { type: 'timestamp', notNull: true },
    location: { type: 'varchar(120)' },
    message: { type: 'varchar(255)' },
    // 'pending' | 'accepted' | 'declined' | 'cancelled'
    status: { type: 'varchar(20)', notNull: true, default: 'pending' },
    from_event_id: { type: 'integer' },
    to_event_id: { type: 'integer' },
    responded_at: { type: 'timestamp' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('friendly_invites', 'from_squad_id');
  pgm.createIndex('friendly_invites', 'to_squad_id');
  pgm.createIndex('friendly_invites', 'status');
};

exports.down = (pgm) => {
  pgm.dropTable('friendly_invites');
};
