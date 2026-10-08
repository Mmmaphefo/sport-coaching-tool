// The tactics table already exists on production (created by migration
// 1790000000002 which failed to record itself in pgmigrations). This
// migration is a no-op that safely records itself: it only creates the
// table/index if they don't already exist, so repeated runs are harmless.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS tactics (
      id serial PRIMARY KEY,
      squad_id integer NOT NULL REFERENCES squads(id) ON DELETE cascade,
      name varchar(100) NOT NULL,
      description text,
      frames jsonb DEFAULT '[]' NOT NULL,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS tactics_squad_id_index ON tactics (squad_id);
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('tactics');
};
