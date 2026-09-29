---
sidebar_position: 3
---

# User Stories

User stories are organised by epic. Each story has a unique ID, description, and story points estimated by the team.

## E1 · Auth & Roles

| ID | Story | As a... | I want to... | So that... | SP |
|---|---|---|---|---|---|
| US1 | Coach & assistant registration and login | user | sign up and log in securely | I can access my squad data | 3 |
| US2 | Password reset & account deletion | user | reset my password or delete my account | I can recover access or remove my data | 3 |
| US21 | Coach self-service sign-up | new visitor | sign up as a coach | I can create my own squad without an admin | 3 |
| US22 | First-login setup flow | new coach | be guided to set up my squad and first athlete | I can start using the app immediately | 3 |
| US23 | Invited assistant sign-up | assistant | accept an invite and join a squad | I can help the coach without sharing their login | 3 |
| US24 | Athlete email invites | coach | invite an athlete by email | they get their own login linked to their roster record | 5 |
| US25 | Temporary password / forced reset | athlete | receive a temporary password and set my own | my account is secure from the start | 3 |
| US26 | Assistant role permission boundary | coach | restrict assistants from editing the roster | I can delegate safely | 3 |

## E2 · Roster Management

| ID | Story | As a... | I want to... | So that... | SP |
|---|---|---|---|---|---|
| US3 | Add athletes to roster | coach | add athlete details | my squad roster is complete and up to date | 3 |
| US4 | Edit or remove athlete | coach | update or remove an athlete | the roster reflects current squad membership | 3 |

## E3 · Event Management

| ID | Story | As a... | I want to... | So that... | SP |
|---|---|---|---|---|---|
| US5 | Create match or training event | coach | schedule an event with date, time, and location | my squad knows when and where to attend | 3 |
| US6 | Edit or cancel event | coach | change or cancel an event | the schedule stays accurate | 3 |
| US13 | Start live event logging | coach | open an event and start logging | I can record actions as they happen | 3 |
| US14 | Log scoring actions | coach/assistant | log goals, penalties, and saves | the score and stats are accurate | 3 |
| US15 | Log disciplinary actions | coach/assistant | log yellow/red cards | player discipline is tracked | 2 |
| US16 | Undo log entry | coach/assistant | undo a mistaken log entry | the record stays accurate | 2 |
| US18 | Venue weather forecast | coach | see the weather for an event venue | I can plan around bad weather | 3 |

## E4 · Infrastructure & Documentation

| ID | Story | As a... | I want to... | So that... | SP |
|---|---|---|---|---|---|
| US-I1 | CI/CD pipeline | developer | have automated lint/test on every push | regressions are caught early | 3 |
| US-I2 | Public documentation site | stakeholder | read product and technical docs | I can understand and evaluate the project | 5 |

## E5 · Statistics, Availability & Advanced Coaching (Sprint 3)

| ID | Story | As a... | I want to... | So that... | SP |
|---|---|---|---|---|---|
| US27 | Athlete & squad comparison | coach | compare two athletes side by side (stats, BMI, form) | I can pick the stronger lineup | 5 |
| US28 | Public squad page | coach | share a read-only squad page (and CSV export) via link | parents and supporters can follow results | 5 |
| US29 | Event notifications | coach | receive reminders before events and invite emails | nobody misses a match or training | 3 |
| US41 | RSVP availability | athlete | mark myself available/unavailable per event | the coach only starts a match with enough players | 5 |
| US42 | Stat override | coach | correct a derived stat with a note | the record stays accurate when the log is wrong | 3 |
| US43 | Clash detection | coach | be warned about scheduling conflicts | my squads never double-book a venue or team | 3 |
| US44 | Venue map editor | coach | drop a pin on a map for the venue | everyone navigates to the exact pitch | 3 |
| US45 | Offline logging | coach/assistant | queue log entries with no signal and replay them | nothing is lost on a weak connection | 5 |
| US46 | Tactics board | coach | draw and save tactics boards | I can rehearse set pieces with the squad | 5 |
| US47 | Sessions / drill library | coach | auto-generate training drills from tactical goals | sessions match what we need to work on | 3 |
| US48 | Match simulation | coach | simulate a match from player ratings | I can demo the app or pre-fill realistic stats | 8 |
| US49 | Squad gender | coach | set my squad's gender and filter matchmaking | female squads aren't drawn against male squads | 3 |
| US50 | Public landing page | visitor | browse public squads and their live events | the community can follow local teams | 3 |

## Story Point Scale

| Points | Meaning |
|---|---|
| 1 | Trivial change, well understood |
| 2 | Small task, low uncertainty |
| 3 | Standard feature, some complexity |
| 5 | Larger feature or integration work |
| 8 | Very large or risky — should be split |
