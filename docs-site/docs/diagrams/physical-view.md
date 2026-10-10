---
sidebar_position: 4
---

# Physical View

The physical view describes how the system is deployed and what infrastructure it runs on.

## Deployment Diagram

```mermaid
graph TB
    subgraph "User Devices"
        A[Coach Laptop]
        B[Assistant Phone]
        C[Athlete Tablet]
    end

    subgraph "Hosting (Local Development)"
        D[React Dev Server<br/>localhost:5173]
        E[Express API<br/>localhost:3000]
        F[PostgreSQL<br/>localhost:5432]
    end

    subgraph "External Services"
        G[Clerk Auth]
        H[Brevo Email]
        I[Open-Meteo Weather API]
    end

    A --> D
    B --> D
    C --> D
    D --> E
    E --> F
    E --> G
    E --> H
    E --> I
```

## Production Deployment Plan

For production, the application will be deployed as follows:

| Component | Planned Service | Reason |
|---|---|---|
| Frontend | Vercel / Netlify / Azure Static Web Apps | Static site hosting with CI-triggered deploys |
| Backend | Azure App Service / Railway / Render | Managed Node.js hosting with environment variables |
| Database | Azure Database for PostgreSQL / Supabase | Managed PostgreSQL with backups |
| Auth | Clerk (hosted) | No auth infrastructure to maintain |
| Email | Brevo | Transactional email to any recipient from one verified sender (replaced Resend, which needs a verified domain) |
| CI/CD | Gitea Actions + self-hosted runner | Already configured; can add deploy steps |

## Environment Variables

| Variable | Purpose |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | Frontend Clerk SDK key |
| `CLERK_SECRET_KEY` | Backend Clerk SDK key |
| `CLERK_WEBHOOK_SECRET` | Verifies Clerk webhook signatures |
| `DATABASE_URL` | PostgreSQL connection string |
| `FRONTEND_URL` | Base URL for invite links |
| `BREVO_API_KEY` | Email service API key (Brevo) |
| `EMAIL_FROM` | Verified sender address for email |
| `RESEND_API_KEY` | Optional fallback email key, used only when `BREVO_API_KEY` is unset |

## CI/CD Pipeline

```mermaid
graph LR
    A[Developer Push] --> B[Gitea Actions]
    B --> C[Frontend Lint]
    B --> D[Frontend Build]
    B --> E[Backend Lint]
    B --> F[Backend Tests<br/>PostgreSQL service]
    C --> G{Pass?}
    D --> G
    E --> G
    F --> G
    G -->|Yes| H[Merge Allowed]
    G -->|No| I[Block Merge]
```
