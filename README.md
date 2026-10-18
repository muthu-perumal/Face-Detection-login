# Attendance

Employee attendance for phones, tablets, and desktops. People register and sign in with an email and password, enroll a face from the browser camera, then clock in and clock out. Administrators review exceptions, correct records, and export CSV.

The browser never decides that a clock event is valid. Netlify Functions check the session, compare the face template, and store the database clock time.

## Verification limits

Face matching uses [`@vladmandic/face-api`](https://github.com/vladmandic/face-api), a maintained browser build of face-api.js. The server compares 128-number descriptors with Euclidean distance and asks the person to turn or nod. That is a **development check**, not certified biometric identification and not certified liveness or presentation-attack detection.

- A detected face is not treated as a verified identity.
- The distance is an uncalibrated model score, not a probability.
- A modified client can still forge samples. The server binds each attempt to a short-lived challenge so a previous payload cannot be replayed.
- Photos with no movement are rejected. A recording of a real movement can still pass.
- Manual attendance remains available. When face verification is required, a manual request waits for an administrator.

Do not describe this deployment as production-grade biometric security. Replacing the matcher means keeping the same serverless contract: the function receives samples, decrypts the stored template, and decides.

## Stack

- React, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, Recharts, Sonner
- Netlify for the static app and Functions
- Neon PostgreSQL for the database you connected
- No always-on Express server

Supabase Auth is not used. The database URL provided for this project is Neon, which does not include Supabase Auth or Supabase API keys. Sign-in is a server-issued signed session checked on every request. PostgreSQL row level security applies after the function switches to the non-owner `app_user` role. The table owner has `BYPASSRLS`, so the application role is what makes the policies active. Administrators cannot select biometric templates; decryption is limited to the signed-in employee’s own row.

## Security notes

- `DATABASE_URL`, `JWT_SECRET`, and `BIOMETRIC_ENCRYPTION_KEY` stay in server environment variables. They are not prefixed with `VITE_`.
- Passwords are hashed with bcrypt. Sessions can be revoked on sign-out and password change.
- Templates are encrypted with AES-256-GCM. To rotate keys, set the old key as `BIOMETRIC_ENCRYPTION_KEY_PREVIOUS`, put the new key in `BIOMETRIC_ENCRYPTION_KEY`, and ask people to re-enroll when convenient. Decryption tries the current key, then the previous key.
- Attendance timestamps and worked minutes are generated in PostgreSQL. Employee requests cannot choose another person’s id or a custom clock time. Administrator corrections are audited.
- Failed face attempts are limited to five in fifteen minutes, then a manual review is opened.
- The database password was pasted into a chat. Rotate it in the Neon console and update the local and Netlify environment. Do not commit `.env`.

## Local setup

1. Install Node.js 22.
2. Install dependencies and the face models:

```bash
npm install
npm run models
npm run db:setup
npm run dev
```

3. Open `http://localhost:5173`.
4. Sign in as the administrator created by `db:setup`. The email and password are `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.
5. For a phone on the same network, camera access needs HTTPS:

```bash
npm run dev:https
```

Accept the local certificate warning, then open the printed network URL. Android Chrome and iPhone Safari can use the camera only in a secure context.

`npm run db:setup` applies `supabase/migrations/001_init.sql` and creates the administrator if that email does not exist.

## Environment

Copy `.env.example` to `.env`.

| Name | Where |
| --- | --- |
| `DATABASE_URL` | Server only |
| `JWT_SECRET` | Server only, at least 32 characters |
| `BIOMETRIC_ENCRYPTION_KEY` | Server only, 64 hex characters |
| `BIOMETRIC_ENCRYPTION_KEY_PREVIOUS` | Server only, optional during rotation |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Used by `db:setup` |
| `VITE_APP_NAME` | Browser |

## Netlify

Build command: `npm run build`  
Publish directory: `dist`  
Functions directory: `netlify/functions`

`netlify.toml` rewrites `/api/*` to the function and sends every other route to `index.html`, so refreshing a React Router page still works.

In the Netlify UI, add the server environment variables above. Do not add the service database URL to a `VITE_` variable. Connect the Git repository, deploy, and open the site on an Android phone, an iPhone, and a laptop webcam. Test camera permission denial, a successful enrollment, clock in, a second clock in, clock out, and an administrator review.

## Tests

```bash
npm test
npm run test:e2e
```

`npm test` checks the attendance math and runs the API against the configured database, including duplicate registration, authorization, face mismatch, still-image rejection, duplicate clock-in, and an 08h 35m correction. Playwright covers the login layout and camera cleanup with a mocked camera. Automated tests do not use a live webcam.

## Main flows

- Employees register without choosing an administrator role. Approval can be required in settings.
- Face enrollment asks for consent, checks one face, lighting, position, and a movement challenge, then stores only ciphertext.
- Clock in and clock out use the same check. A second clock in or a clock out without a clock in is rejected.
- History supports a month calendar and status filter. People only receive their own rows.
- Administrators see today’s counts, employees, corrections, reviews, settings, and CSV export. They see enrollment status, not templates.
