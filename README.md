# bcn_quiz

NestJS API for quizzes, topics, courses, attempt sessions, project submissions, and certificates. Authentication is proxied to the Profiles API; learning data lives in PostgreSQL; media uses Cloudinary signed uploads.

## Stack

- NestJS 11 + Prisma 7 (PostgreSQL via `@prisma/adapter-pg`)
- Auth: Bearer / cookie validated against `PROFILES_API_BASE_URL`
- Cache: in-memory GET response cache
- Logging: Winston (+ optional Loki)

## Setup

```bash
cp .env.example .env
# fill DATABASE_URL, PORT, PROFILES_API_BASE_URL, Cloudinary keys

docker compose up -d   # local Postgres on :5433 + pgAdmin :5050
npm install
npx prisma migrate deploy
npm run db:seed        # optional
npm run start:dev
```

API listens on `PORT` (required).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run start:dev` | Watch mode |
| `npm run start:prod` | `prisma migrate deploy` then run `dist` |
| `npm run db:migrate` | Create/apply migrations (dev) |
| `npm run migrate:deploy` | Apply migrations (CI/prod) |
| `npm test` | Unit tests |
| `npm run lint` | ESLint |

## Main modules

- `auth` — login / 2FA / refresh / logout / me (Profiles proxy)
- `quiz` / `topic` — catalog CRUD (admin), public quiz payloads hide answers
- `attempt` — timed topic sessions, scoring, topic progress
- `course` — curriculum, project submit/review, course progress
- `certificate` — issued certificates for completed courses

### Topic slug lookup

`GET /topic/slug/:slug` and `GET /topic/slug/:slug/quizzes` accept optional `?courseId=` because the same slug may exist in more than one course. Without `courseId`, an ambiguous slug returns `409 Conflict`.

## Production notes

- Prefer `migrate deploy` over `db push`.
- Do not commit `/data` (Docker volumes) or `/prisma/client` leftovers.
- Set `REQUEST_QUERY_LOG=false` unless debugging.

## License

UNLICENSED (private).
