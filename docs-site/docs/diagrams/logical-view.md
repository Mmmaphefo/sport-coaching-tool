---
sidebar_position: 1
---

# Logical View

The logical view describes the main domain entities and their relationships.

## Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o| SQUADS : "owns (coach)"
    SQUADS ||--o{ USERS : "has (assistants/athletes)"
    SQUADS ||--o{ ATHLETES : has
    ATHLETES ||--o| USERS : "may log in as"
    SQUADS ||--o{ EVENTS : schedules
    EVENTS ||--o{ EVENT_TEAMS : "joined by"
    SQUADS ||--o{ EVENT_TEAMS : participates
    EVENTS ||--o{ FIXTURES : contains
    SQUADS ||--o{ FIXTURES : "plays (home)"
    SQUADS ||--o{ FIXTURES : "plays (away)"
    EVENTS ||--o{ LOG_ENTRIES : records
    FIXTURES ||--o{ LOG_ENTRIES : records
    ATHLETES ||--o{ LOG_ENTRIES : "attributed to"
    USERS ||--o{ LOG_ENTRIES : logs
    SQUADS ||--o{ INVITES : "invites into"
    USERS ||--o{ INVITES : sends
    ATHLETES ||--o| INVITES : "links existing roster row"

    USERS {
        serial id PK
        varchar clerk_id UK
        varchar role
        integer squad_id FK
    }
    SQUADS {
        serial id PK
        integer coach_id FK "UK"
        varchar name
        integer min_roster_size
        boolean onboarded
    }
    ATHLETES {
        serial id PK
        integer squad_id FK
        varchar name
        varchar position
        integer squad_number
        date date_of_birth
        varchar contact_info
        varchar email
        integer user_id FK
    }
    EVENTS {
        serial id PK
        integer squad_id FK
        varchar title
        varchar event_type
        varchar format
        varchar status
        timestamp event_date
        varchar location
        integer duration_minutes
        integer required_teams
        integer created_by FK
    }
    EVENT_TEAMS {
        serial id PK
        integer event_id FK
        integer squad_id FK
        varchar role
        integer seed_order
    }
    FIXTURES {
        serial id PK
        integer event_id FK
        integer home_squad_id FK
        integer away_squad_id FK
        varchar status
        timestamp event_date
    }
    LOG_ENTRIES {
        serial id PK
        integer event_id FK
        integer fixture_id FK
        integer athlete_id FK
        varchar action_type
        integer value
        integer minute
        integer logged_by FK
        timestamp deleted_at
    }
    INVITES {
        serial id PK
        varchar email
        integer squad_id FK
        integer invited_by FK
        varchar token UK
        varchar status
        varchar role
        integer athlete_id FK
    }
```

## Key Design Decisions

- **Coach owns one squad.** The `squads.coach_id` column is unique, enforcing that a coach has exactly one squad.
- **Athletes can be invited to log in.** The `athletes.user_id` links a roster row to a Clerk-backed user account once the athlete accepts an invite.
- **Log entries are the source of truth.** Stats are derived from `log_entries` rather than stored separately, preventing drift.
- **Soft deletes for logs.** The `deleted_at` column supports undo during live logging while preserving an audit trail.
- **Events support multiple formats.** A simple match/training uses only `events`; leagues and tournaments generate `fixtures` and `event_teams`.
