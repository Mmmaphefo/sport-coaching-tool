---
sidebar_position: 3
---

# Development View

The development view shows the main components and packages in the codebase.

## Component Diagram

```mermaid
graph TB
    subgraph Frontend
        A[React App] --> B[Clerk Provider]
        A --> C[React Router]
        A --> D[Pages]
        D --> D1[Dashboard]
        D --> D2[Roster]
        D --> D3[Events]
        D --> D4[Live Match]
        D --> D5[Athlete Stats]
        D --> D6[Settings]
        A --> E[Components]
        E --> E1[Layout]
        E --> E2[ProtectedRoute]
        A --> F[Lib]
        F --> F1[api.js]
    end

    subgraph Backend
        G[Express App] --> H[Middleware]
        H --> H1[auth.js]
        G --> I[Routes]
        I --> I1[account.js]
        I --> I2[athletes.js]
        I --> I3[events.js]
        I --> I4[invites.js]
        I --> I5[squads.js]
        I --> I6[webhooks.js]
        I --> I7[weather.js]
        G --> J[Helpers]
        J --> J1[_squad.js]
        J --> J2[userDeletion.js]
        J --> J3[email.js]
        G --> K[Database]
        K --> L[node-postgres]
        L --> M[PostgreSQL]
    end

    subgraph External
        N[Clerk]
        O[Brevo]
        P[Open-Meteo Weather API]
    end

    A -->|HTTPS/JSON| G
    B --> N
    H1 --> N
    I4 --> O
    I7 --> P
    I6 --> N
```

## Package Structure

```
sport-coaching-tool/
├── backend/
│   ├── migrations/          # Database schema versions
│   ├── src/
│   │   ├── app.js           # Express app setup
│   │   ├── middleware/
│   │   │   └── auth.js      # Clerk token verification
│   │   ├── routes/
│   │   │   ├── _squad.js    # Squad/user resolution helpers
│   │   │   ├── account.js   # Account deletion
│   │   │   ├── athletes.js  # Roster CRUD
│   │   │   ├── events.js    # Events + live logging
│   │   │   ├── invites.js   # Assistant/athlete invites
│   │   │   ├── squads.js    # Squad CRUD
│   │   │   ├── weather.js   # Weather API proxy
│   │   │   └── webhooks.js  # Clerk webhooks
│   │   └── lib/
│   │       ├── userDeletion.js
│   │       └── email.js
│   └── tests/
│       └── integration/     # Integration tests with real DB
├── frontend/
│   ├── src/
│   │   ├── components/      # Layout, ProtectedRoute
│   │   ├── lib/
│   │   │   └── api.js       # API client
│   │   └── pages/           # Page components
│   └── public/
└── docs-site/
    └── docs/                # This documentation
```

## Separation of Concerns

| Layer | Responsibility |
|---|---|
| **Frontend pages** | UI rendering, user input, role-aware controls |
| **Frontend lib** | API calls, token handling |
| **Backend routes** | HTTP handling, request validation, response formatting |
| **Backend middleware** | Authentication, Clerk integration |
| **Backend helpers** | Shared business logic (squad resolution, deletion cleanup) |
| **Database** | Persistence, referential integrity, migrations |
