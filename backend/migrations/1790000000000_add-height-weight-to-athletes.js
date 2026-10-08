exports.up = (pgm) => {
  pgm.addColumns('athletes', {
    height_cm: { type: 'integer' },
    weight_kg: { type: 'integer' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('athletes', ['height_cm', 'weight_kg']);
};
