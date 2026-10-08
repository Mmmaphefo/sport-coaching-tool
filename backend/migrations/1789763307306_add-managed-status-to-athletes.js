exports.up = (pgm) => {
  pgm.addColumn('athletes', {
    is_managed: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.removeColumn('athletes', 'is_managed');
};