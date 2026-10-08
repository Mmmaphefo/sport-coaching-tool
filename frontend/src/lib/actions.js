// Shared action types for live event logging.
// `scoring` determines the default value of the "counts toward result" checkbox.
export const ACTION_TYPES = [
  { value: 'goal', label: 'Goal', scoring: true },
  { value: 'assist', label: 'Assist', scoring: false },
  { value: 'point', label: 'Point', scoring: true },
  { value: 'penalty', label: 'Penalty', scoring: false },
  { value: 'shot_on_target', label: 'Shot on Target', scoring: false },
  { value: 'save', label: 'Save', scoring: false },
  { value: 'yellow_card', label: 'Yellow Card', scoring: false },
  { value: 'red_card', label: 'Red Card', scoring: false },
  { value: 'substitution', label: 'Substitution', scoring: false },
  { value: 'other', label: 'Other', scoring: false },
]

// Quick-tap actions shown on the Live Match dashboard. Assists are not a
// standalone action: they are picked as part of logging the goal itself.
export const QUICK_ACTIONS = [
  { value: 'goal', label: 'Goal', scoring: true, tone: 'goal' },
  { value: 'penalty', label: 'Penalty', scoring: false, tone: 'orange' },
  { value: 'shot_on_target', label: 'Shot on Target', scoring: false, tone: 'shot' },
  { value: 'save', label: 'Save', scoring: false, tone: 'neutral' },
  { value: 'yellow_card', label: 'Yellow Card', scoring: false, tone: 'yellow' },
  { value: 'red_card', label: 'Red Card', scoring: false, tone: 'red' },
  { value: 'substitution', label: 'Substitution', scoring: false, tone: 'neutral' },
]

export function formatActionType(type) {
  return type.replace(/_/g, ' ')
}
