// Keyword-matched injury recovery estimator.
//
// Ranges below are sourced from sports-medicine literature and orthopaedic
// clinical guidance (general-population / typical-athlete figures, not
// elite-professional outliers). This is a planning estimate for a coach,
// never a medical determination — every value is coach-editable (US30),
// and the UI must always show it as an estimate to confirm with a medical
// professional.
//
// Weeks are [min, max] typical return-to-play ranges.

const SEVERITY_TIER_DEFAULTS = {
  minor: [1, 2],
  moderate: [4, 6],
  severe: [10, 12],
};

const INJURY_LOOKUP = [
  {
    id: 'achilles',
    label: 'Achilles tendon rupture',
    keywords: ['achilles'],
    default: [20, 26],
    sourceNote: 'General-population estimate (~6 months); elite professionals average closer to 11 months.',
  },
  {
    id: 'acl',
    label: 'ACL tear / reconstruction',
    keywords: ['acl', 'anterior cruciate'],
    default: [24, 40],
    sourceNote: 'Most orthopaedic sources cite 6-9 months as typical return-to-sport after ACL reconstruction.',
  },
  {
    id: 'meniscus',
    label: 'Meniscus tear',
    keywords: ['meniscus'],
    default: [8, 16],
    sourceNote: 'Partial meniscectomy ~6-9 weeks; surgical repair often extends to 20+ weeks.',
  },
  {
    id: 'hamstring',
    label: 'Hamstring strain',
    keywords: ['hamstring'],
    grades: { mild: [1, 3], moderate: [4, 8], severe: [12, 16] },
    sourceNote: 'Grade-based recovery windows are consistent across sports-medicine sources.',
  },
  {
    id: 'quad',
    label: 'Quadriceps strain',
    keywords: ['quad strain', 'quadriceps', 'quad tear', 'pulled quad'],
    grades: { mild: [1, 3], moderate: [4, 8], severe: [12, 16] },
    sourceNote: 'Follows the same grading pattern as other major muscle strains.',
  },
  {
    id: 'groin',
    label: 'Groin / adductor strain',
    keywords: ['groin', 'adductor'],
    grades: { mild: [2, 3], moderate: [4, 8], severe: [12, 16] },
    sourceNote: 'Multiple sports-medicine sources converge on this grading.',
  },
  {
    id: 'calf',
    label: 'Calf strain',
    keywords: ['calf'],
    grades: { mild: [1, 3], moderate: [4, 8], severe: [12, 16] },
    sourceNote: 'Assumed consistent with general muscle-strain grading (hamstring/quad/groin); not separately verified.',
  },
  {
    id: 'ankle',
    label: 'Ankle sprain',
    keywords: ['ankle sprain', 'sprained ankle', 'rolled ankle'],
    grades: { mild: [1, 2], moderate: [3, 6], severe: [6, 12] },
    sourceNote: 'Standard three-grade ligament-sprain classification used across sports-medicine sources.',
  },
  {
    id: 'concussion',
    label: 'Concussion',
    keywords: ['concussion', 'head injury', 'head knock'],
    default: [1, 4],
    sourceNote: 'Median symptom resolution ~8-9 days; full return-to-play protocol typically 2-4 weeks. Always requires medical clearance regardless of this estimate.',
  },
  {
    id: 'shoulder-dislocation',
    label: 'Shoulder dislocation',
    keywords: ['dislocated shoulder', 'shoulder dislocation'],
    default: [6, 12],
    sourceNote: 'Non-surgical recovery; surgical cases can extend to around 6 months.',
  },
  {
    id: 'fracture',
    label: 'Fracture / broken bone',
    keywords: ['fracture', 'broken bone', 'broken leg', 'broken arm', 'broken foot', 'broken hand'],
    default: [6, 16],
    sourceNote: 'Highly dependent on which bone (e.g. metatarsal ~6-8wk vs. femoral shaft ~12-20wk) — treat as a rough midpoint only.',
  },
];

function detectGrade(text) {
  if (/(grade\s*3|grade\s*iii|severe|complete tear|full tear|rupture)/.test(text)) return 'severe';
  if (/(grade\s*2|grade\s*ii|moderate|partial tear)/.test(text)) return 'moderate';
  if (/(grade\s*1|grade\s*i\b|mild|minor)/.test(text)) return 'mild';
  return null;
}

function estimateFromDescription(description) {
  if (!description) return null;
  const text = description.toLowerCase();

  for (const entry of INJURY_LOOKUP) {
    if (!entry.keywords.some((k) => text.includes(k))) continue;

    if (entry.grades) {
      const grade = detectGrade(text) || 'moderate';
      const range = entry.grades[grade];
      return {
        matchedLabel: `${entry.label} (${grade}${detectGrade(text) ? '' : ' — no grade stated, assumed'})`,
        minWeeks: range[0],
        maxWeeks: range[1],
        sourceNote: entry.sourceNote,
      };
    }

    return {
      matchedLabel: entry.label,
      minWeeks: entry.default[0],
      maxWeeks: entry.default[1],
      sourceNote: entry.sourceNote,
    };
  }

  return null;
}

function estimateFromSeverityTier(severity) {
  const range = SEVERITY_TIER_DEFAULTS[severity] || SEVERITY_TIER_DEFAULTS.moderate;
  return { minWeeks: range[0], maxWeeks: range[1] };
}

// Returns { returnDate, basis, minWeeks, maxWeeks } — never throws.
function estimateReturn(description, dateSustained, severity) {
  const keywordMatch = estimateFromDescription(description);

  let minWeeks, maxWeeks, basis;
  if (keywordMatch) {
    ({ minWeeks, maxWeeks } = keywordMatch);
    basis = `Matched: ${keywordMatch.matchedLabel}. ${keywordMatch.sourceNote} Estimate only — confirm with a medical professional.`;
  } else {
    ({ minWeeks, maxWeeks } = estimateFromSeverityTier(severity));
    basis = `No specific injury matched in the description — used the ${severity || 'moderate'} severity default. Estimate only — confirm with a medical professional.`;
  }

  const avgWeeks = (minWeeks + maxWeeks) / 2;
  const sustained = new Date(`${dateSustained}T00:00:00Z`);
  const returnDate = new Date(sustained.getTime() + Math.round(avgWeeks * 7) * 86400000);

  return {
    returnDate: returnDate.toISOString().slice(0, 10),
    basis,
    minWeeks,
    maxWeeks,
  };
}

module.exports = { estimateReturn, SEVERITY_TIER_DEFAULTS };