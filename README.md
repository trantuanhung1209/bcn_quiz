# bcn_quiz

NestJS API for quizzes, topics, courses, attempt sessions, project submissions, and certificates. Authentication is proxied to the Profiles API; learning data lives in PostgreSQL; media uses Cloudinary signed uploads.

## Stack

- NestJS 11 + Prisma 7 (PostgreSQL via `@prisma/adapter-pg`)
- Auth: Bearer / cookie validated against `PROFILES_API_BASE_URL`
- Email OTP / 2FA mail: gửi qua **Profiles** (Resend) — quiz không gửi SMTP trực tiếp
- Cache: Redis (`REDIS_URL` or Sentinel via `REDIS_SENTINELS` + `REDIS_SENTINEL_NAME`) for auth-token + shared GET catalog + Throttler; key prefix `bcn:quiz:`
- Logging: Winston (+ optional Loki)

## Setup

Shared infra (1 Postgres with DBs `profiles` + `bcn_quiz`, shared Redis) lives in workspace `../infra`:

```bash
# from NestJS root, or:
docker compose up -d
# optional pgAdmin: docker compose --profile tools up -d
# details: ../infra/README.md
```

```bash
cp .env.example .env
# DATABASE_URL=.../bcn_quiz  REDIS_URL=redis://localhost:6379  PROFILES_API_BASE_URL=...

npm install
npx prisma migrate deploy
npm run db:seed        # optional
npm run start:dev
```

API listens on `PORT` (required). Redis is required in production (`REDIS_URL` or Sentinel).

## Scripts

| Script                   | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `npm run start:dev`      | Watch mode                              |
| `npm run start:prod`     | `prisma migrate deploy` then run `dist` |
| `npm run db:migrate`     | Create/apply migrations (dev)           |
| `npm run migrate:deploy` | Apply migrations (CI/prod)              |
| `npm test`               | Unit tests                              |
| `npm run lint`           | ESLint                                  |

## Main modules

- `auth` — login / 2FA / refresh / logout / me (Profiles proxy)
- `quiz` / `topic` — catalog CRUD (admin), public quiz payloads hide answers
- `attempt` — timed topic sessions, scoring, topic progress
- `course` — curriculum, project submit/review, course progress
- `certificate` — issued certificates for completed courses

### Topic slug lookup

`GET /topic/slug/:slug` and `GET /topic/slug/:slug/quizzes` accept optional `?courseId=` because the same slug may exist in more than one course. Without `courseId`, an ambiguous slug returns `409 Conflict`.

### Topic schedule window

Optional `startsAt` / `endsAt` on a Topic control when students may take the exam set (inclusive start, exclusive end). Both `null` = always open (legacy topics). Responses include derived `availability`: `OPEN` | `SCHEDULED` | `CLOSED`.

- Before `startsAt`: start / save / submit are rejected (`TOPIC_NOT_OPEN_YET`).
- After `endsAt`: no new sessions and no saves (`TOPIC_CLOSED`); **submit** is still allowed for an existing session (same idea as session timer expiry).
- Session `expiresAt` is `min(now + expiresInMinutes, endsAt)` when `endsAt` is set.
- Admin can change the window any time via `PUT /topic/:id` (e.g. daily or weekly windows). Recurring RRULE schedules are out of scope.
- `GET /topic*` and course detail/slug/topics are **not** response-cached (schedule `availability` must stay fresh). Shared catalog cache covers `/quiz*`, `GET /course`, and project-requirement only; quiz/topic/course writes invalidate it.

## Production notes

- Prefer `migrate deploy` over `db push`.
- Do not commit `/data` (Docker volumes) or `/prisma/client` leftovers.
- Set `REQUEST_QUERY_LOG=false` unless debugging.

### BCN organization deployment

Production deployment is defined by `.github/workflows/ci.yml` and
`docker-compose.prod.yml`. It runs only from `main`, publishes the immutable
Git SHA image to `ghcr.io/bcn-org/bcn_quiz`, and deploys it through the BCN
organization runner to `/opt/apps/bcn_quiz`.

Create a GitHub Environment named `production` before the first deployment.
At minimum, configure:

- Variables: `APP_PORT=3001`, `HOST_PORT` (assigned by BCN infra),
  `POSTGRES_USER=quiz`, `POSTGRES_DB=bcn_quiz`, and
  `PROFILES_API_BASE_URL=http://bcn_profiles:3000`.
- Secrets: `POSTGRES_PASSWORD`, `REDIS_URL`, and
  `REDIS_PASSWORD`. CI generates the database URL with host `quiz-postgres`;
  the shared Redis URL must use host `redis`.

Cloudinary uploads require the variables `CLOUDINARY_CLOUD_NAME` and
`CLOUDINARY_API_KEY`, plus the secret `CLOUDINARY_API_SECRET`. Other settings
from `.env.example` are mapped by the workflow and use application defaults
when omitted.

Before enabling production deployment:

1. Move or transfer the repository to `bcn-org` and use `main` as its default
   branch.
2. Confirm `HOST_PORT` is unique on the production server.
3. Confirm the external Docker network `bcn_profiles_default` exists. Quiz
   uses it for shared Redis and internal Profiles authentication.
4. Start Docker locally and run `docker build -t bcn-quiz:test .`.
5. Merge to `main`, then monitor the `CI/CD` workflow and `/health` check.

## License

UNLICENSED (private).
