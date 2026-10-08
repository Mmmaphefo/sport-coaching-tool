exports.up = (pgm) => {
  pgm.addColumns('athletes', {
    tactical_tags: { type: 'varchar(255)' },
    coach_notes: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('athletes', ['tactical_tags', 'coach_notes']);
};
