// Remember which email each users row belongs to. KickStat decides what a
// signed-in account is (coach / assistant / athlete) from the email it uses —
// invites carry the email → role/squad mapping — so the linking logic needs
// the account's email stored next to its Clerk id. Nullable for rows created
// before this column existed; the app backfills it on next login.
exports.up = (pgm) => {
  pgm.addColumn('users', {
    email: { type: 'varchar(255)' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'email');
};
