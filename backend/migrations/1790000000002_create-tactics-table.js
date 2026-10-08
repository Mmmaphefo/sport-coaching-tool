exports.up = (pgm) => {
  pgm.createTable('tactics', {
    id: { type: 'serial', primaryKey: true },
    squad_id: { type: 'integer', notNull: true, references: 'squads(id)', onDelete: 'cascade' },
    name: { type: 'varchar(100)', notNull: true },
    description: { type: 'text' },
    frames: { type: 'jsonb', notNull: true, default: '[]' },
    created_at: { type: 'timestamp', default: pgm.func('now()') },
    updated_at: { type: 'timestamp', default: pgm.func('now()') },
  });

  pgm.createIndex('tactics', 'squad_id');
};

exports.down = (pgm) => {
  pgm.dropTable('tactics');
};
