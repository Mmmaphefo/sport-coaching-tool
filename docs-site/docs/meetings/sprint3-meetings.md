# Sprint 3 Meeting Minutes
**Project:** KickStat - Sport Coaching Tool  
**Sprint Period:** September 15 - September 29, 2026  
**Team Members:** Kgethie, Kgotlelelo, Lindokuhle, Mmaphefo, Tasmiya  

---

## Meeting 1: Sprint 3 Planning
**Date:** Thursday, 17/09/2026  
**Time:** 17:00 - 18:30  
**Attendees:** All team members  

### Agenda
1. Sprint 3 objectives based on tutor feedback
2. Bug fixes and feature prioritization
3. Task allocation

### Discussion Points

**Expectations for Sprint 3:**
- Majority of features should be complete by Sprint 3
- Minor changes can be done before final submission
- Must justify any feature removals

**Identified Bugs:**
1. Email notifications not sending
2. Cannot schedule match dates within leagues
3. Live match timer always shows zero
4. Can schedule matches on past dates
5. Weather widget not displaying
6. Cannot end training session after starting live
7. Cannot edit events after creation
8. Events can start at wrong times
9. Events don't auto-start at scheduled time
10. Live matches only visible to creator

### Task Allocation
- **Kgethie:** Public landing page, testing
- **Tasmiya:** Athlete & Squad Comparison, remove pro fixtures, testing
- **Mmaphefo:** Assistant access, bug fixes, testing
- **Lindo:** Add RSVPs, stat overrides, clash detection, public squad page, venue map, offline logging
- **Kgotlelelo:** UI redesign 

### Decisions Made
1. **Priority:** Fix critical bugs before adding new features
2. **Testing:** Each member tests their features locally before pushing
3. **Code Review:** Push to separate branches first, then merge to main after verification

---

## Meeting 2: Bug Fixes Progress
**Date:** Friday, September 18/09/2026
**Time:** 15:00 - 15:40  
**Attendees:** All team members 

### Progress Update
**Bugs:** Fixed bugs 2-9 and 10, pushed to separate branch for testing  
**Deployment:** Confirmed deployed version working after Render cold start explanation  
**Remaining issues:** Identified remaining issues with account creation freeze

### Key Decisions
1. **Render Cold Start:** Team documented that Render free tier sleeps after 15 minutes - first request may timeout
2. **Email Issue:** Assistant recieves link but email verification still not working
3. **Pro Fixtures:** Decision made to remove (justification documented separately)

---

## Meeting 3: UI Redesign Review
**Date:** Saturday, 19/09/2026 
**Time:** 14:30 - 14:50
**Attendees:** All team members  

### Kgotlelelo's Redesign Summary
Complete redesign of KickStat frontend with unified brand design system:
- Navy/blue/volt-lime color tokens
- Barlow Condensed display typeface
- Dark theme support
- 9 commits grouped by concern

### Features Redesigned
1. **Dashboard:** Squad intelligence overview with stat cards, readiness charts, live score card
2. **Events:** Hero strip, calendar toggle, fixture-style rows
3. **Roster:** Squad stat strip, position filters
4. **Player Profile:** Full analytics with heat maps, radar charts
5. **League Centre:** Standings table, leaderboards, fixture grid
6. **Live Match Centre:** Dark-theme scoreboard

### User Feedback 
**Issue:** Dark mode has UI inconsistencies - text not visible on some pages  
**Decision:** Keep dark mode but fix consistency issues across all pages  
**Action:** Fix dark mode text visibility

---

## Meeting 4: Feature Testing & Validation
**Date:** Sunday, 20/09/2026 
**Time:** 22:00 - 22:20  
**Attendees:** All team members  

### Testing Results
1. **Live Logging:** Working correctly with pitch visualization
2. **Mobile Responsiveness:** Confirmed working on mobile devices
3. **Match Simulation:** Feature discussed and approved for implementation

### New Feature Discussion: Match Simulation
**Proposal (Lindo):** Add simulation button that auto-runs matches without manual logging  
**Benefit:** Generates realistic stats for teams without assistants  
**Decision:** Approved for implementation

### User Feedback
- **Team consensus:** UI redesign significantly improved user experience

---

## Meeting 5: Sprint 3 Feature Completion
**Date:** Monday, 21/09/2026 
**Time:** 00:20 - 00:40 
**Attendees:** All team members  

### Status Update
**Complete:** UI design, Pro Fixture removal, Athlete & Squad Comparison
** In Progress:** Public landing page, Venue maps, Offline logging, stats overview.

### Remaining Work
1. Player RSVP feature (US41)
2. Offline logging improvements
3. Assistant access permissions
4. Email functionality 

---

## Meeting 6: Final Feature Additions
**Date:** Wednesday, 23/09/2026
**Time:** 10:10 - 12:45  
**Attendees:** All team members

### Completed Features 
1. **RSVP through availability** - Done
2. **Clash detection** (match overlap) - Done
3. **Public squad page** (shareable link) - Done
4. **Venue Map** - Done
5. **Offline logging** - Done (slow performance noted)
6. **Stats override** - Done
7. **Tactics board save fix** - Done

### Additional Features Proposed
1. **Tactics feature** - Create and save tactics boards
2. **Sessions feature ** - Auto-generate training sessions based on tactical goals

---

## Meeting 7: Gender Feature Implementation
**Date:** Thursday, 24/09/2026
**Time:** 20:00 - 20:14  
**Attendees:** All team members 

### Feature Request (Kgethie)
**Issue:** Gender should be considered because currently a female squad can join/play against males"

**Decision:** Implement gender filtering for squad matchmaking

### Completed Features
- Tactics and Sessions added to fill gaps in coaching workflow

---

## Meeting 8: Testing & Documentation
**Date:** Saturday, 25/09/2026
**Time:** 12:12 - 13:00  
**Attendees:** All team members  

### Completed Features
- Gender filter
- Implement CSV export for public squad page

### Remaining Issues
1. **Public squad page:** Needs CSV export functionality
2. **Dark mode:** Some text visibility issues remain
3. **Email:** Still not functioning

### Documentation Discussion
**Issue:** AI attribution requirement per COMS3011A AI Policy  
**Decision:** All AI-assisted code must be documented in comments and reports

---

## Meeting 9: Final Testing & Documentation
**Date:** Monday, 28/09/2026
**Time:** 12:12 - 13:00  
**Attendees:** All team members + Austin (Tutor)
**Place:** MSL in person

### Meeting Summary
- Let Austin run through the app to make sure everything was functioning and ready for sprint 3.

### Remaining Issues
1. **Weather:** Bug in the weather code that needs to be fixed
2. **Dark mode:** Some text visibility issues remain
3. **Assistant Email:** Works locally but not on the deployed site
4. **Squad landing page:** Needs to be added

### Sprint 3 Status
- **Core Features:** 95% complete
- **Bug Fixes:** 9/10 resolved
- **UI Redesign:** 100% complete
- **Testing:** 51/51 tests passing
- **Documentation:** In progress
- **Email notification system:** In progress
---

## Action Items for Sprint 4 (Final Submission) 
1. Finalize documentation (group report, API docs, user guide)
2. Prepare presentation materials to show Austin 
3. Conduct final user testing session

 
**Next meeting:** Sprint 4 planning - September 29, 2026
