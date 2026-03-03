# Daily Interview Practice App

Production-ready Next.js app for gamified daily interview practice with:

- 1-2 daily questions (timezone-aware)
- AI evaluation + hints + give-up model answer mode
- Dedicated per-question chat path with saved history
- XP, levels, streaks, accuracy, topic progress, and performance graph
- Admin panel for topics/questions and dashboard metrics
- Supabase email auth + Postgres backend
- Vercel-ready deployment

## Stack

- Next.js 15 (App Router, TypeScript)
- Supabase (Auth + Postgres)
- OpenAI API

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env vars:

```bash
cp .env.example .env.local
```

3. Fill `.env.local` values.

4. In Supabase SQL Editor, run `db/schema.sql`.

5. Start local app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Auth & Admin

- Sign in uses Supabase magic link email.
- Grant admin by setting `profiles.is_admin = true` for your user.

## API Routes

- `GET /api/profile` profile bootstrap/read
- `POST /api/profile` timezone update
- `GET /api/daily` assign/load daily questions
- `POST /api/evaluate` hint/submit/give-up evaluation
- `GET|POST /api/chat` dedicated question chat/history
- `GET /api/history` gamification and analytics data
- `GET /api/admin/stats` admin dashboard
- `GET|POST /api/admin/topics` topic CRUD (create/read)
- `GET|POST|PUT|DELETE /api/admin/questions` question CRUD

## Mobile Optimization Included

- Mobile-first layout and typography
- Sticky bottom navigation
- Card-based touch UI
- Responsive forms and large tap targets
- Compact chart and progress components for smaller screens

## Notes

- Bulk upload (PDF/Word/Excel) is scaffolded as a future extension point in admin workflows.
- OpenAI output parsing includes fallbacks for resilience.
