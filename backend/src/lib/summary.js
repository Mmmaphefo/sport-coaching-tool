// T22: Auto post-match summary & highlights.
// Derives a short narrative plus a highlights reel from a match's log entries —
// no AI, just deterministic aggregation over goals, cards and penalties so the
// text always agrees with the recorded timeline.
//
// The caller classifies each entry with `side: 'us' | 'them'` (simple events:
// athlete_id != NULL is "us"; fixtures: depends on whether our squad is home or
// away) so the same builder works for both match types.

function ordinalSuffix(n) {
  if (n === null || n === undefined) return '';
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

function minuteLabel(entry) {
  return entry.minute != null ? `${entry.minute}'` : '';
}

// timeline: rows with { action_type, minute, athlete_name, value, is_scoring, side }
// meta: { squadName, opponent, gf, ga }
function buildMatchSummary(timeline, meta) {
  const sorted = [...(timeline || [])].sort((a, b) => {
    const am = a.minute ?? 999;
    const bm = b.minute ?? 999;
    return am - bm || new Date(a.logged_at) - new Date(b.logged_at);
  });

  const scoringActions = sorted.filter(
    (l) => l.is_scoring && ['goal', 'penalty_scored'].includes(l.action_type)
  );
  const ourGoals = scoringActions.filter((l) => l.side === 'us');
  const theirGoals = scoringActions.filter((l) => l.side === 'them');

  const gf = meta.gf;
  const ga = meta.ga;
  const outcome = gf > ga ? 'win' : gf < ga ? 'loss' : 'draw';
  const resultWord = { win: 'Victory', loss: 'Defeat', draw: 'Draw' }[outcome];

  const yellowCards = sorted.filter((l) => l.action_type === 'yellow_card');
  const redCards = sorted.filter((l) => l.action_type === 'red_card');
  const penaltiesScored = sorted.filter((l) => l.action_type === 'penalty_scored');
  const penaltiesMissed = sorted.filter(
    (l) => l.action_type === 'penalty_missed' || l.action_type === 'penalty_saved'
  );

  // --- Narrative ---
  const sentences = [];
  if (scoringActions.length === 0) {
    sentences.push(
      `A goalless afternoon — neither ${meta.squadName} nor ${meta.opponent} could find the net.`
    );
  } else {
    const scorers = ourGoals.map((g) => `${g.athlete_name || 'Unknown'} (${minuteLabel(g) || 'undated'})`);
    if (scorers.length > 0) {
      sentences.push(`${meta.squadName}'s goals came from ${scorers.join(', ')}.`);
    } else {
      sentences.push(`${meta.squadName} drew a blank in front of goal.`);
    }
    if (theirGoals.length > 0) {
      const oppScorers = theirGoals.map((g) => minuteLabel(g) || 'an undated strike');
      sentences.push(`${meta.opponent} replied on ${oppScorers.join(' and ')}.`);
    }

    const opener = scoringActions[0];
    const openerName = opener.athlete_name || (opener.side === 'us' ? meta.squadName : meta.opponent);
    sentences.push(
      `${openerName} opened the scoring in the ${ordinalSuffix(opener.minute)} minute.`
    );
    if (scoringActions.length > 1) {
      // The goal that locked in the final margin is the decisive one.
      let runningUs = 0;
      let runningThem = 0;
      let decisive = null;
      for (const g of scoringActions) {
        if (g.side === 'us') runningUs += g.value || 1;
        else runningThem += g.value || 1;
        if (runningUs === gf && runningThem === ga) decisive = g;
      }
      const lastGoal = scoringActions[scoringActions.length - 1];
      if (decisive && decisive !== opener) {
        const name = decisive.athlete_name || (decisive.side === 'us' ? meta.squadName : meta.opponent);
        sentences.push(`${name}'s strike on ${minuteLabel(decisive) || 'the death'} proved decisive.`);
      } else if (lastGoal && lastGoal !== opener) {
        const name = lastGoal.athlete_name || (lastGoal.side === 'us' ? meta.squadName : meta.opponent);
        sentences.push(`The last word came on ${minuteLabel(lastGoal)} through ${name}.`);
      }
    }
  }

  if (redCards.length > 0) {
    sentences.push(
      `The match turned spiky: ${redCards.map((c) => `${c.athlete_name || 'a player'} saw red on ${minuteLabel(c) || 'an unknown minute'}`).join(', ')}.`
    );
  } else if (yellowCards.length > 0) {
    sentences.push(
      `Discipline: ${yellowCards.length} yellow card${yellowCards.length === 1 ? '' : 's'} shown (${yellowCards.map((c) => `${c.athlete_name || 'opponent'} ${minuteLabel(c)}`.trim()).join(', ')}).`
    );
  }
  if (penaltiesScored.length > 0) {
    sentences.push(
      `From the spot: ${penaltiesScored.map((p) => `${p.athlete_name || 'the opposition'} converted on ${minuteLabel(p) || 'an unknown minute'}`).join(', ')}.`
    );
  }
  if (penaltiesMissed.length > 0) {
    sentences.push(
      `Spot-kick heartbreak: ${penaltiesMissed.map((p) => `${p.athlete_name || 'the opposition'} was denied on ${minuteLabel(p) || 'an unknown minute'}`).join(' and ')}.`
    );
  }

  const narrative = sentences.join(' ');

  // --- Highlights reel ---
  const highlights = [];
  if (scoringActions.length > 0) {
    const opener = scoringActions[0];
    highlights.push({
      minute: opener.minute,
      kind: 'goal',
      text: `First goal: ${opener.athlete_name || (opener.side === 'us' ? meta.squadName : meta.opponent)} ${minuteLabel(opener)}`.trim(),
    });
    const lastGoal = scoringActions[scoringActions.length - 1];
    if (scoringActions.length > 1) {
      highlights.push({
        minute: lastGoal.minute,
        kind: 'goal',
        text: `Final strike: ${lastGoal.athlete_name || (lastGoal.side === 'us' ? meta.squadName : meta.opponent)} ${minuteLabel(lastGoal)}`.trim(),
      });
    }
    // Braces / hat-tricks for our players
    const counts = new Map();
    for (const g of ourGoals) {
      const name = g.athlete_name || 'Unknown';
      counts.set(name, (counts.get(name) || 0) + (g.value || 1));
    }
    for (const [name, count] of counts) {
      if (count >= 3) {
        highlights.push({ minute: null, kind: 'milestone', text: `Hat-trick hero: ${name} with ${count} goals` });
      } else if (count === 2) {
        highlights.push({ minute: null, kind: 'milestone', text: `Brace: ${name} scored twice` });
      }
    }
  }
  for (const c of redCards) {
    highlights.push({
      minute: c.minute,
      kind: 'card',
      text: `Red card: ${c.athlete_name || 'Opponent'} ${minuteLabel(c)}`.trim(),
    });
  }
  for (const p of penaltiesScored) {
    highlights.push({
      minute: p.minute,
      kind: 'penalty',
      text: `Penalty converted: ${p.athlete_name || 'Opponent'} ${minuteLabel(p)}`.trim(),
    });
  }
  for (const p of penaltiesMissed) {
    highlights.push({
      minute: p.minute,
      kind: 'penalty',
      text: `Penalty missed: ${p.athlete_name || 'Opponent'} ${minuteLabel(p)}`.trim(),
    });
  }

  return {
    headline: `${meta.squadName} ${gf}-${ga} ${meta.opponent} — ${resultWord}`,
    result: outcome,
    gf,
    ga,
    narrative,
    highlights,
    stats: {
      goals: scoringActions.length,
      yellowCards: yellowCards.length,
      redCards: redCards.length,
      penaltiesScored: penaltiesScored.length,
      penaltiesMissed: penaltiesMissed.length,
    },
  };
}

module.exports = { buildMatchSummary, ordinalSuffix };
