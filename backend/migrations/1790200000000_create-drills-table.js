exports.up = (pgm) => {
  pgm.createTable('drills', {
    id: 'id',
    squad_id: { type: 'integer', notNull: true, references: 'squads(id)', onDelete: 'cascade' },
    name: { type: 'varchar(100)', notNull: true },
    description: { type: 'text' },
    tactical_goal: { type: 'varchar(30)', notNull: true },
    age_group: { type: 'varchar(20)', notNull: true, default: 'First Team' },
    duration_minutes: { type: 'integer' },
    equipment: { type: 'text' },
    instructions: { type: 'text' },
    created_at: { type: 'timestamp', default: pgm.func('now()') },
    updated_at: { type: 'timestamp', default: pgm.func('now()') },
  })

  pgm.createIndex('drills', ['squad_id', 'tactical_goal', 'age_group'])
}

exports.down = (pgm) => {
  pgm.dropTable('drills')
}
