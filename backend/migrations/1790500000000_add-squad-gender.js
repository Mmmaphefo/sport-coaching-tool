exports.up = (pgm) => {
  pgm.addColumn('squads', {
    gender: { type: 'varchar(10)', notNull: true, default: 'mixed' },
  })

  pgm.addConstraint('squads', 'squads_gender_check', {
    check: "gender IN ('male', 'female', 'mixed')",
  })
}

exports.down = (pgm) => {
  pgm.dropConstraint('squads', 'squads_gender_check')
  pgm.dropColumn('squads', 'gender')
}
