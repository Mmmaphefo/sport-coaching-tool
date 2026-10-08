// Match simulator: turns two match-day squads (starting XI + bench) into a
// full 90-minute script of loggable events — goals with assists, cards,
// substitutions, shots and saves.
//
// Player quality drives everything: each side's expected goals come from its
// attack rating measured against the other side's defence rating, and inside
// a team the better players (by position and overall) are likelier to be the
// one scoring, assisting, shooting or being booked. Nothing is seeded, so
// every simulation produces a different match.
//
// The output is deliberately shaped like the POST /logs body so the client
// can replay a simulation through the exact same endpoint the coach uses when
// logging by hand — the stored records are identical either way.

const { positionGroup } = require('./ratings');

const FULL_TIME_MINUTE = 90;
const HOME_ADVANTAGE = 0.12;

// Baseline goals for an even match; the rating swing scales it up or down.
const BASE_EXPECTED_GOALS = 1.25;
// A 10-point rating advantage between attack and opposing defence roughly
// doubles the expected goals, which keeps a stronger side dominant without
// making upsets impossible.
const RATING_SWING_DIVISOR = 28;

const GOAL_SHARE = {
  ST: 6, W: 4, AM: 3.5, CM: 2, DM: 0.8, FB: 0.5, CB: 0.4, GK: 0.02,
};
const ASSIST_SHARE = {
  W: 4, AM: 4, CM: 3, ST: 2.5, FB: 2.5, DM: 1.5, CB: 0.4, GK: 0.05,
};
const SHOT_SHARE = {
  ST: 5, W: 3.5, AM: 3, CM: 1.6, DM: 0.7, FB: 0.5, CB: 0.3, GK: 0.01,
};
const CARD_SHARE = {
  DM: 3, CB: 2.5, FB: 2.5, CM: 2, AM: 1.2, W: 1.2, ST: 1, GK: 0.2,
};

// Roughly one goal in eleven is a penalty, and penalties in this app are
// logged as a non-scoring action type (the coach marks it as counting only
// when it was converted).
const PENALTY_GOAL_CHANCE = 0.09;
const PENALTY_AWARDED_CHANCE = 0.18;
const ASSIST_CHANCE = 0.68;
const SAVE_CHANCE = 0.6;
// Cards occasionally land on someone who never got on the pitch.
const BENCH_CARD_CHANCE = 0.06;
const RED_CARD_CHANCE = 0.05;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function poisson(lambda) {
  const limit = Math.exp(-lambda);
  let count = 0;
  let product = Math.random();
  while (product > limit) {
    count += 1;
    product *= Math.random();
  }
  return count;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Picks a player with probability proportional to `weightOf(player)`.
function weightedPick(players, weightOf) {
  if (players.length === 0) return null;
  const weights = players.map((player) => Math.max(0, weightOf(player)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return players[randomInt(0, players.length - 1)];
  let roll = Math.random() * total;
  for (let i = 0; i < players.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return players[i];
  }
  return players[players.length - 1];
}

// Better players attract more of everything; cubing the ratio keeps the
// difference noticeable without letting one star take every event.
function playerWeight(player, table) {
  const group = positionGroup(player.position);
  const share = table[group] || table.CM;
  return share * Math.pow((player.rating || 75) / 78, 3);
}

// Attack / midfield / defence lines, each an average of the players who play
// there, falling back to the team average when a line is empty (a squad may
// have no listed goalkeeper, for example).
function teamStrength(players) {
  const overall = average(players.map((player) => player.rating || 75)) ?? 75;
  const buckets = new Map();
  for (const player of players) {
    const group = positionGroup(player.position);
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push(player.rating || 75);
  }
  const lineOf = (groups) => {
    const values = groups.flatMap((group) => buckets.get(group) || []);
    return average(values) ?? overall;
  };
  return {
    overall,
    attack: lineOf(['ST', 'W', 'AM']),
    midfield: lineOf(['DM', 'CM', 'AM']),
    defence: lineOf(['GK', 'CB', 'FB']),
  };
}

// Expected goals for a side, from its attack against the opposing defence.
function expectedGoals(attack, defence, advantage = 0) {
  const swing = Math.pow(10, (attack - defence) / RATING_SWING_DIVISOR);
  return clamp(BASE_EXPECTED_GOALS * swing * (1 + advantage), 0.15, 4.5);
}

function createTeamState(side, squad) {
  const starters = (squad?.starters || []).map((player) => ({ ...player, side }));
  const bench = (squad?.bench || []).map((player) => ({ ...player, side }));
  return {
    side,
    generic: false,
    starters,
    bench,
    onPitch: [...starters],
    benchAvailable: [...bench],
    sentOff: new Set(),
  };
}

// A simple event's opponent has no roster — only a name and an estimated
// standard. Every event against them lands on `athlete_id: null`, which is
// how the app already records opponent actions for non-league events.
function createGenericOpponent(side, rating) {
  return {
    side,
    generic: true,
    rating,
    starters: [],
    bench: [],
    onPitch: [],
    benchAvailable: [],
    sentOff: new Set(),
  };
}

function teamStrengthOf(team) {
  if (team.generic) {
    return { overall: team.rating, attack: team.rating, midfield: team.rating, defence: team.rating };
  }
  return teamStrength(team.onPitch.length > 0 ? team.onPitch : team.starters);
}

// Builds the raw "something happens at this minute" markers for one team.
function scheduleTeam(team, expectedGoalsForTeam) {
  const schedule = [];
  const goals = poisson(expectedGoalsForTeam);
  for (let i = 0; i < goals; i += 1) {
    schedule.push({ side: team.side, minute: randomInt(1, FULL_TIME_MINUTE), kind: 'goal' });
  }
  if (Math.random() < PENALTY_AWARDED_CHANCE) {
    schedule.push({ side: team.side, minute: randomInt(5, FULL_TIME_MINUTE), kind: 'penalty' });
  }
  const yellows = Math.min(poisson(1.7), 4);
  for (let i = 0; i < yellows; i += 1) {
    schedule.push({ side: team.side, minute: randomInt(10, FULL_TIME_MINUTE), kind: 'yellow' });
  }
  if (Math.random() < RED_CARD_CHANCE) {
    schedule.push({ side: team.side, minute: randomInt(25, 88), kind: 'red' });
  }
  // Substitutions: mostly the classic second-half window, sometimes early
  // (an injury). Never more than the bench can supply.
  const maxSubs = Math.min(team.benchAvailable.length, 4);
  if (maxSubs > 0) {
    const subs = Math.min(randomInt(2, 4), maxSubs);
    for (let i = 0; i < subs; i += 1) {
      const early = Math.random() < 0.15;
      schedule.push({
        side: team.side,
        minute: early ? randomInt(30, 45) : randomInt(46, 85),
        kind: 'sub',
      });
    }
  }
  const shots = Math.min(3 + poisson(3), 9);
  for (let i = 0; i < shots; i += 1) {
    schedule.push({ side: team.side, minute: randomInt(1, FULL_TIME_MINUTE), kind: 'shot' });
  }
  return schedule;
}

// The goalkeeper currently between the sticks, if one is on the pitch.
function activeGoalkeeper(team) {
  if (team.generic) return null;
  return team.onPitch.find((player) => positionGroup(player.position) === 'GK') || null;
}

function pickScorer(team) {
  if (team.generic) return null;
  return weightedPick(team.onPitch, (player) => playerWeight(player, GOAL_SHARE));
}

function pickAssister(team, scorer) {
  if (team.generic || !scorer) return null;
  const candidates = team.onPitch.filter((player) => player.athlete_id !== scorer.athlete_id);
  if (candidates.length === 0 || Math.random() > ASSIST_CHANCE) return null;
  return weightedPick(candidates, (player) => playerWeight(player, ASSIST_SHARE));
}

function pickShooter(team) {
  if (team.generic) return null;
  return weightedPick(team.onPitch, (player) => playerWeight(player, SHOT_SHARE));
}

function pickCardTarget(team) {
  if (team.generic) return null;
  if (team.benchAvailable.length > 0 && Math.random() < BENCH_CARD_CHANCE) {
    return team.benchAvailable[randomInt(0, team.benchAvailable.length - 1)];
  }
  return weightedPick(team.onPitch, (player) => playerWeight(player, CARD_SHARE));
}

// Applies a scheduled substitution to the running state and returns the pair
// involved, or null when the team cannot substitute.
function applyScheduledSub(team) {
  if (team.generic || team.benchAvailable.length === 0) return null;
  // Keepers are only swapped in emergencies — a red card is already handled
  // by taking that player off the pitch.
  const outfield = team.onPitch.filter(
    (player) => !team.sentOff.has(player.athlete_id) && positionGroup(player.position) !== 'GK'
  );
  const off = outfield.length > 0
    ? outfield[randomInt(0, outfield.length - 1)]
    : team.onPitch.find((player) => !team.sentOff.has(player.athlete_id)) || null;
  if (!off) return null;
  const on = team.benchAvailable.shift();
  team.onPitch = team.onPitch.filter((player) => player.athlete_id !== off.athlete_id);
  team.onPitch.push(on);
  return { off, on };
}

// Simulates one match. `home`/`away` are { starters, bench } squads whose
// players carry { athlete_id, name, position, rating }; pass `away: null`
// with `opponentRating` for a simple event whose opponent has no roster.
function simulateMatch({ home, away, opponentRating = 76 }) {
  const homeState = createTeamState('home', home);
  const awayState = away
    ? createTeamState('away', away)
    : createGenericOpponent('away', opponentRating);
  const states = { home: homeState, away: awayState };

  const homeStrength = teamStrengthOf(homeState);
  const awayStrength = teamStrengthOf(awayState);
  const homeExpected = expectedGoals(homeStrength.attack, awayStrength.defence, HOME_ADVANTAGE);
  const awayExpected = expectedGoals(awayStrength.attack, homeStrength.defence, 0);

  const schedule = [
    ...scheduleTeam(homeState, homeExpected),
    ...scheduleTeam(awayState, awayExpected),
  ];
  // Order by minute, with a random tiebreak so two events in the same minute
  // do not always resolve in the same order.
  schedule.forEach((entry) => { entry.tiebreak = Math.random(); });
  schedule.sort((a, b) => a.minute - b.minute || a.tiebreak - b.tiebreak);

  const events = [];
  let homeGoals = 0;
  let awayGoals = 0;
  const push = (event) => {
    events.push({ minute: clamp(event.minute, 1, FULL_TIME_MINUTE), ...event });
  };

  for (const entry of schedule) {
    const team = states[entry.side];
    const opponent = states[entry.side === 'home' ? 'away' : 'home'];

    if (entry.kind === 'goal') {
      const scorer = pickScorer(team);
      const isPenalty = Math.random() < PENALTY_GOAL_CHANCE;
      const assist = isPenalty ? null : pickAssister(team, scorer);
      push({
        minute: entry.minute,
        team_side: entry.side,
        action_type: isPenalty ? 'penalty' : 'goal',
        is_scoring: !isPenalty,
        athlete_id: scorer ? scorer.athlete_id : null,
        assist_athlete_id: assist ? assist.athlete_id : null,
      });
      if (!isPenalty) {
        if (entry.side === 'home') homeGoals += 1;
        else awayGoals += 1;
      }
    } else if (entry.kind === 'penalty') {
      const taker = pickShooter(team);
      push({
        minute: entry.minute,
        team_side: entry.side,
        action_type: 'penalty',
        is_scoring: false,
        athlete_id: taker ? taker.athlete_id : null,
        assist_athlete_id: null,
      });
    } else if (entry.kind === 'yellow' || entry.kind === 'red') {
      const target = pickCardTarget(team);
      push({
        minute: entry.minute,
        team_side: entry.side,
        action_type: entry.kind === 'red' ? 'red_card' : 'yellow_card',
        is_scoring: false,
        athlete_id: target ? target.athlete_id : null,
        assist_athlete_id: null,
      });
      // A sent-off player takes no further part in the match — neither on the
      // pitch nor later off the bench.
      if (entry.kind === 'red' && target) {
        team.sentOff.add(target.athlete_id);
        team.onPitch = team.onPitch.filter((player) => player.athlete_id !== target.athlete_id);
        team.benchAvailable = team.benchAvailable.filter((player) => player.athlete_id !== target.athlete_id);
      }
    } else if (entry.kind === 'sub') {
      const swap = applyScheduledSub(team);
      if (swap) {
        push({
          minute: entry.minute,
          team_side: entry.side,
          action_type: 'substitution',
          is_scoring: false,
          athlete_id: swap.off.athlete_id,
          substitute_athlete_id: swap.on.athlete_id,
        });
      }
    } else if (entry.kind === 'shot') {
      const shooter = pickShooter(team);
      push({
        minute: entry.minute,
        team_side: entry.side,
        action_type: 'shot_on_target',
        is_scoring: false,
        athlete_id: shooter ? shooter.athlete_id : null,
        assist_athlete_id: null,
      });
      // Most shots on target are kept out by the opposing keeper — only
      // possible when that side actually has one on the pitch.
      const keeper = activeGoalkeeper(opponent);
      if (keeper && Math.random() < SAVE_CHANCE) {
        push({
          minute: entry.minute,
          team_side: opponent.side,
          action_type: 'save',
          is_scoring: false,
          athlete_id: keeper.athlete_id,
          assist_athlete_id: null,
        });
      }
    }
  }

  events.sort((a, b) => a.minute - b.minute);

  return {
    events,
    summary: {
      homeStrength: Number(homeStrength.overall.toFixed(1)),
      awayStrength: Number(awayStrength.overall.toFixed(1)),
      homeExpectedGoals: Number(homeExpected.toFixed(2)),
      awayExpectedGoals: Number(awayExpected.toFixed(2)),
      homeGoals,
      awayGoals,
      eventCount: events.length,
    },
  };
}

module.exports = {
  FULL_TIME_MINUTE,
  expectedGoals,
  teamStrength,
  simulateMatch,
};
