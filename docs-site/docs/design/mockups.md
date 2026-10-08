---
sidebar_position: 3
---

# Mockups & Prototypes

This page shows low-fidelity wireframes and high-fidelity mockups for the core screens of Kickstat.

## Low-Fidelity Wireframes

### Coach Dashboard

```
+--------------------------------------------------+
|  Kickstat        Dashboard  Roster  Events     |
+--------------------------------------------------+
|                                                  |
|  WELCOME BACK, COACH                             |
|  Here's what's happening with your squad today.  |
|                                                  |
|  +------------------+  +----------------------+  |
|  | UPCOMING EVENTS  |  | INVITE AN ASSISTANT  |  |
|  |                  |  |                      |  |
|  | • Training       |  |  [assistant@email  ] |
|  |   Today 17:00    |  |  [   Send invite   ] |
|  |                  |  +----------------------+  |
|  | • vs Eagles FC   |                          |
|  |   Sat 10:00      |  +----------------------+  |
|  |                  |  | LIVE EVENT           |  |
|  +------------------+  | Eagles FC  2 - 1     |  |
|                        | [Open live match]    |  |
|  +------------------+  +----------------------+  |
|  | QUICK LINKS      |                             |
|  | [View roster]    |                             |
|  | [Create event]   |                             |
|  +------------------+                             |
|                                                  |
+--------------------------------------------------+
```

### Roster Page (Coach View)

```
+--------------------------------------------------+
|  Kickstat        Dashboard  Roster  Events     |
+--------------------------------------------------+
|                                                  |
|  ROSTER                              [+ Athlete] |
|  Manage your squad members.                      |
|                                                  |
|  +---------------------------------------------+ |
|  | Name        | Pos | # | DOB        | Actions| |
|  |-------------|-----|---|------------|--------| |
|  | Amahle D.   | FW  | 9 | 2005-03-12 |   | |
|  | Lindo M.    | MF  | 8 | 2004-07-22 |   | |
|  | Kgotso K.   | DF  | 4 | 2006-01-05 |   | |
|  +---------------------------------------------+ |
|                                                  |
+--------------------------------------------------+
```

### Roster Page (Assistant View)

```
+--------------------------------------------------+
|  Kickstat        Dashboard  Roster  Events     |
+--------------------------------------------------+
|                                                  |
|  ROSTER                                          |
|  View squad members.                             |
|                                                  |
|  +------------------------------------------+    |
|  | Name        | Pos | # | DOB             |    |
|  |-------------|-----|---|-----------------|    |
|  | Amahle D.   | FW  | 9 | 2005-03-12      |    |
|  | Lindo M.    | MF  | 8 | 2004-07-22      |    |
|  +------------------------------------------+    |
|                                                  |
|  (No add/edit buttons — read-only)               |
|                                                  |
+--------------------------------------------------+
```

### Live Match Logging

```
+--------------------------------------------------+
|  Kickstat        Dashboard  Roster  Events     |
+--------------------------------------------------+
|                                                  |
|  LIVE MATCH — vs Eagles FC          17'  2 - 1  |
|                                                  |
|  +------------------+  +----------------------+  |
|  | SELECT ATHLETE   |  | SELECT ACTION        |  |
|  |                  |  |                      |  |
|  | ○ Amahle D.      |  | [  Goal  ]           |  |
|  | ○ Lindo M.       |  | [ Penalty ]          |  |
|  | ○ Opponent       |  | [Yellow Card]        |  |
|  |                  |  | [ Red Card ]         |  |
|  | Minute: [__17__] |  | [   Save   ]         |  |
|  +------------------+  +----------------------+  |
|                                                  |
|  RECENT LOGS                                     |
|  12' Goal — Amahle D.                    [Undo]  |
|  15' Yellow Card — Eagles FC             [Undo]  |
|  17' Goal — Lindo M.                     [Undo]  |
|                                                  |
+--------------------------------------------------+
```

### Athlete Stats Page

```
+--------------------------------------------------+
|  Kickstat        Dashboard  Stats   Events     |
+--------------------------------------------------+
|                                                  |
|  AMAHLE DLAMINI                                  |
|  Forward | Squad #9                              |
|                                                  |
|  +------+ +------+ +------+ +------+            |
|  |  12  | |   8  | |  3   | |  1   |            |
|  |Apps  | |Goals | |Assists| |Cards |            |
|  +------+ +------+ +------+ +------+            |
|                                                  |
|  RECENT EVENTS                                   |
|  • vs Eagles FC — 2 goals, 1 assist              |
|  • Training — attended                            |
|  • vs Lions FC — 1 goal                          |
|                                                  |
+--------------------------------------------------+
```

## High-Fidelity Mockups

Below are visual mockups of the key screens, styled with the Kickstat design system.

### Dashboard Mockup

![Dashboard mockup](/img/mockup-dashboard.png)

### Roster Mockup

![Roster mockup](/img/mockup-roster.png)

### Live Match Mockup

![Live match mockup](/img/mockup-live-match.png)

## Prototype Notes

- All mockups follow the mobile-first responsive layout.
- Coach and assistant views differ only in the visibility of write controls.
- Athletes see a personalised stats view instead of the squad dashboard.
- Colour is used to reinforce state: green for live/success, red for destructive actions, gold for primary CTAs.
