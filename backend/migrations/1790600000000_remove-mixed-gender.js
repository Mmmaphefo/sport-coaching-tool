exports.up = (pgm) => {
  // Update any existing 'mixed' squads to 'male' as default
  pgm.sql("UPDATE squads SET gender = 'male' WHERE gender = 'mixed'");

  // Drop old constraint and add new one without 'mixed'
  pgm.dropConstraint('squads', 'squads_gender_check');
  pgm.addConstraint('squads', 'squads_gender_check', {
    check: "gender IN ('male', 'female')",
  });

  // Change default to 'male'
  pgm.alterColumn('squads', 'gender', {
    default: 'male',
  });
}

exports.down = (pgm) => {
  pgm.alterColumn('squads', 'gender', {
    default: 'mixed',
  });
  pgm.dropConstraint('squads', 'squads_gender_check');
  pgm.addConstraint('squads', 'squads_gender_check', {
    check: "gender IN ('male', 'female', 'mixed')",
  });
}
