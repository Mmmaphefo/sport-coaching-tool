// Athlete rating (T21): a coach-maintained overall quality 1-100 used, together
// with recent form, to rank lineup suggestions. Kept on the athletes row since
// it represents the coach's current view, not a historical record.
exports.up = (pgm) => {
  pgm.addColumns('athletes', {
    rating: {
      type: 'integer',
      // 1-100, coach-set; NULL = unrated (treated as a neutral 50 for ranking)
      check: 'rating IS NULL OR (rating >= 1 AND rating <= 100)',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('athletes', 'rating');
};
