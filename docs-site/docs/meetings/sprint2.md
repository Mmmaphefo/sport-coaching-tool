# Sprint 2 Meetings — Sport Coaching Tool

**Course:** COMS3011A
**Team:** bug-off

---

## Work Distribution Meeting

**Date:** Late August 2026 (following Milestone 1 marking)
**Duration:** —
**Location:** WhatsApp (Online)
**Type:** Sprint Planning / Work Distribution

**Attendees:**
- Lindokuhle
- Kgethego
- Mmaphefo
- Tasmiya
- Kgotlelelo

**Absentees:** None

**Description:** Following the marking of Milestone 1, the team met to review feedback and divide Sprint 2 work across the backlog epics: Injury Tracking (E6), League & Tournament Events — Setup (E7), continued documentation work, deployment, CI/CD stability, and testing.

**Discussion Points:**
1. Reviewed Milestone 1 marking feedback and identified areas needing improvement for Sprint 2
2. Reviewed the Sprint 2 backlog items — Injury Tracking (US29–US31) and League Setup (US32–US33)
3. Allocated responsibility for deployment, pipeline stability, documentation, and testing across the team
4. Agreed each member would flag blockers early given the reduced review window before the Product Owner check-in

**Decisions Made / Task Assignments:**
- **Tasmiya:** Improve project-specific documentation, deploy the application, resolve outstanding CI/CD pipeline issues, and add further backend testing
- **Kgethego:** Document meeting minutes, deploy the public documentation website, and improve parts of the UI. During Sprint 2 she additionally picked up and resolved further pipeline issues, fixed issues on the main branch, and implemented additional test cases
- **Mmaphefo:** Improve test coverage and contribute to frontend testing
- **Lindokuhle:** Implement the Injury Tracking feature end-to-end (US29–US31), and assist with documentation improvements
- **Kgotlelelo:** Own the League & Tournament Events (Setup) user stories (US32–US33)

**Next Meeting:**
- **Purpose:** Sprint Review with the Product Owner, to demo Sprint 2 progress

---

## Sprint Review Meeting — Product Owner Check-In

**Date:** 14/09/2026
**Duration:** —
**Location:** —
**Type:** Sprint Review

**Attendees:**
- Lindokuhle
- Kgethego
- Mmaphefo
- Tasmiya
- Kgotlelelo
- Product Owner

**Description:** The team met with the Product Owner to demonstrate the features implemented during Sprint 2 and to confirm progress remained on track against the plans previously shared with him.

**Discussion Points:**
1. Demonstrated the Sprint 2 features implemented by the team, including Injury Tracking and League & Tournament Event setup
2. Walked the Product Owner through progress against the roadmap shared at the start of the sprint
3. Product Owner evaluated the current state of the UI and overall user flow

**Feedback / Decisions Made:**
- Product Owner confirmed the team is on track against the agreed plan
- Requested colour changes to align the UI more closely with the product's intended look and feel
- Requested additional UI adjustments to improve the overall flow of the app
- Action items to be picked up as polish work following Sprint 2

---

## Development Update — Injury Tracking Feature Complete

**Date:** 14/09/2026
**Location:** WhatsApp (Online)
**Type:** Async Development Update
**Posted by:** Lindokuhle

**Update:**
All user stories under the Injury Tracking epic (US29 — Log an Athlete Injury, US30 — Return-to-Play Estimate, US31 — Injury Flags on Roster) are complete.

One change was made from the original product backlog specification for the return-to-play estimate (US30). Rather than calculating the suggested return date from a fixed number of days per severity tier, the implementation now uses a curated reference table of common sporting injuries with recovery times confirmed by medical sources. The system searches this table using keywords extracted from the athlete's injury description (with severity — minor, intermediate, severe — still captured and used) to produce a more realistic, injury-specific return date rather than a generic severity-based estimate.

The work has been pushed to the `injury-tracking` branch, and a pull request has been opened. Lindokuhle requested that another team member review the PR before it is merged into `main`, to avoid breaking existing functionality.

**Next Steps:**
- A team member to review and approve the `injury-tracking` pull request
- Merge into `main` once review is complete
- Apply the UI colour and flow changes requested by the Product Owner during the Sprint Review

**Notes:**
- All items on the Milestone 2 (Sprint 2) rubric were completed by the team during this sprint.
