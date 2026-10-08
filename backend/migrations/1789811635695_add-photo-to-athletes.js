exports.up = (pgm) => {
  // Athlete profile photo, stored as a client-downscaled data URL (the
  // format/size limits live in backend/src/routes/athletes.js PATCH).
  // Kept inline in Postgres rather than on disk because the hosting
  // filesystem is ephemeral — uploaded files would vanish on redeploy.
  pgm.addColumn('athletes', {
    photo: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.removeColumn('athletes', 'photo');
};
