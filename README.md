# PrepLoop

> **Build sharp interview answers through daily practice, AI coaching, and gamified progress tracking.**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?logo=supabase)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://dailyquestion.saiii.in)

**Live:** [dailyquestion.saiii.in](https://dailyquestion.saiii.in)

---

## What is PrepLoop?

PrepLoop is a gamified daily interview practice platform. Each day, users receive 1–2 curated interview questions, submit their answers, get instant AI-powered feedback with scores and improvement tips, and level up through a comprehensive XP and mastery system. Consistent practice is rewarded with streaks, missions, and achievement badges.

---

## Features

### Daily Practice
- **1–2 questions per day** — unlocked progressively based on IST midnight reset
- **Topic-based filtering** — focus on areas you want to improve
- **Question difficulty** — 5 levels (D1–D5) with scaled XP rewards

### AI Coaching
- **Answer evaluation** — GPT-4o-mini scores your answer (1–10) with strengths, gaps, and improvement guidance
- **Hint system** — request hints without seeing the full answer (XP penalty applies)
- **Give-up flow** — reveals the model answer with a personalized comparison
- **Coaching chat** — persistent per-question AI conversation for deep follow-up

### Gamification
- **XP & Levels** — Beginner → Pro → Expert → Elite
- **Streaks** — daily consistency tracking with bronze/silver/gold/diamond badges
- **Topic mastery** — per-topic progress score (0–100) using a blended rolling formula
- **Missions** — daily and weekly challenges (e.g., "complete 3 questions", "get 5 direct matches")
- **Achievements** — unlockable badges for streaks, accuracy, XP milestones, and mastery

### Admin Panel
- Manage topics and questions (create, edit, bulk upload)
- Platform metrics: total users, average score, question stats
- System configuration

### Performance Dashboard
- Daily history with scores, accuracy, XP, and streak data
- Per-topic progress and answered question counts
- Mission and achievement progress

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5.7 |
| UI | React 19, Custom CSS |
| Auth | Supabase Auth (Email OTP + Google OAuth) |
| Database | Supabase (PostgreSQL with RLS) |
| AI | OpenAI API — `gpt-4o-mini` |
| Deployment | Vercel |

---

## Project Structure

```
preploop/
├── app/
│   ├── layout.tsx              # Root layout with AuthProvider
│   ├── page.tsx                # Home dashboard (XP, streaks, missions)
│   ├── practice/
│   │   ├── page.tsx            # Practice studio (Q&A, evaluation, coaching)
│   │   └── chat/[id]/          # Per-question chat view
│   ├── admin/                  # Admin dashboard
│   ├── history/                # Performance history page
│   ├── chat-history/           # Chat history viewer
│   └── api/
│       ├── daily/              # Fetch / unlock daily questions
│       ├── evaluate/           # Submit answers, hints, give-up
│       ├── chat/               # AI coaching chat
│       ├── profile/            # User profile & stats
│       ├── history/            # Performance data
│       ├── topics/             # Topics list
│       └── admin/              # Admin stats, topics, questions, system
├── components/
│   ├── auth-provider.tsx       # Auth context & hooks
│   ├── auth-panel.tsx          # Sign-in UI
│   ├── app-shell.tsx           # Layout wrapper
│   └── stats-strip.tsx         # Stats display
├── lib/
│   ├── db.ts                   # All database operations
│   ├── gamification.ts         # XP, level, mastery calculations
│   ├── chat-memory.ts          # Chat session summary logic
│   ├── openai.ts               # OpenAI client
│   ├── time.ts                 # IST timezone & daily reset logic
│   ├── types.ts                # TypeScript interfaces
│   └── supabase/               # Browser & server Supabase clients
└── db/
    └── schema.sql              # Full PostgreSQL schema
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project
- An [OpenAI](https://platform.openai.com) API key

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/preploop.git
cd preploop
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Model to use (default: `gpt-4o-mini`) |

### 4. Set up the database

Run the schema against your Supabase project:

```bash
# Via Supabase dashboard: SQL Editor → paste contents of db/schema.sql
# Or via Supabase CLI:
supabase db push
```

The schema creates 11 tables with RLS policies:
`profiles`, `topics`, `questions`, `daily_questions`, `chat_sessions`, `chat_messages`, `performance_history`, `topic_mastery`, `missions`, `user_mission_progress`, `achievements`, `user_achievements`

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment

This project is deployed on [Vercel](https://vercel.com) with Supabase as the managed backend.

```bash
# Deploy via Vercel CLI
npx vercel --prod

# Or connect your GitHub repo in the Vercel dashboard
# and add the environment variables under Project Settings → Environment Variables
```

**Live instance:** [dailyquestion.saiii.in](https://dailyquestion.saiii.in)

---

## Gamification Details

### XP System

| Difficulty | Base XP |
|---|---|
| D1 (Easy) | 10 |
| D2 | 14 |
| D3 (Medium) | 18 |
| D4 | 24 |
| D5 (Hard) | 30 |

- Score bonus: +2 XP per point above 5 (max +10)
- Direct match bonus: extra XP for nailing the ideal answer without hints
- Hint penalty: -3 XP per hint used
- Coaching penalty: -2 XP per coaching turn
- Mission & achievement bonuses stack on top

### Levels

| Level | XP Range |
|---|---|
| Beginner | 0 – 699 |
| Pro | 700 – 1,499 |
| Expert | 1,500 – 2,399 |
| Elite | 2,400+ |

### Topic Mastery

Mastery (0–100) uses a blended rolling formula:
```
new_mastery = 0.82 × previous + 0.18 × current_attempt
```
Weighted by difficulty, with bonuses for direct matches and penalties for hints.

---

## API Overview

| Endpoint | Method | Description |
|---|---|---|
| `/api/daily` | GET | Fetch today's questions |
| `/api/daily` | POST | Unlock next question |
| `/api/evaluate` | POST | Submit answer / request hint / give-up |
| `/api/chat` | POST | Chat with AI coach |
| `/api/chat/history` | GET | Retrieve chat messages |
| `/api/profile` | GET | User profile & stats |
| `/api/history` | GET | Performance dashboard data |
| `/api/topics` | GET | List all topics |
| `/api/admin/stats` | GET | Platform metrics (admin only) |
| `/api/admin/questions` | GET/POST/PUT | Manage questions (admin only) |
| `/api/admin/topics` | GET/POST | Manage topics (admin only) |

---

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a pull request

Please follow the existing code style and keep PRs focused on a single concern.

---

## License

This project is licensed under the **Apache License 2.0** — see the [LICENSE](LICENSE) file for details.
