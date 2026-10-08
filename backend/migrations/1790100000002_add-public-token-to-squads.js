exports.up = (pgm) => {
  pgm.addColumn('squads', {
    public_token: { type: 'varchar(64)' },
    is_public: { type: 'boolean', notNull: true, default: false },
  });

  pgm.addConstraint('squads', 'squads_public_token_unique', {
    unique: ['public_token'],
  });

  pgm.createIndex('squads', 'public_token');
};

exports.down = (pgm) => {
  pgm.dropColumns('squads', ['public_token', 'is_public']);
};
