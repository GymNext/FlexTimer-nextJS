# FlexTimer App

Next.js app for FlexTimer: Firebase Auth + Firestore (`users/<userId>` with `workouts`, `workoutCollections`, `workoutPlans`).

## Routes

- **`/`** – Home (placeholder for future regular user app)
- **`/admin`** – Admin: list all users, search by User ID / email / display name
- **`/admin/users/[userId]`** – Admin: user profile (Auth record + Firestore counts)

Regular user routes can live alongside these later (e.g. `/dashboard`, `/workouts`) without conflicting.

## Setup

1. Copy env example and fill in values:

   ```bash
   cp .env.local.example .env.local
   ```

2. **Firebase Client** (for admin sign-in in the browser):

   - `NEXT_PUBLIC_FIREBASE_*` from your Firebase project (e.g. Project settings → General → Your apps).

3. **Firebase Admin** (server-only, for listing users and reading Firestore):

   - **Option A:** Download a service account key (Project settings → Service accounts → Generate new private key), save as `./serviceAccountKey.json`, and set:
     - `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json`
   - **Option B:** In hosted environments (e.g. Vercel), set:
     - `FIREBASE_ADMIN_PROJECT_ID`
     - `FIREBASE_ADMIN_CLIENT_EMAIL`
     - `FIREBASE_ADMIN_PRIVATE_KEY` (private key string, `\n` for newlines)

4. **Admin access:** Set `ADMIN_USER_IDS` to a comma-separated list of Firebase Auth UIDs that may use `/admin` and the admin API. Example:
   - `ADMIN_USER_IDS=abc123,def456`

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use “Go to Admin” to open the admin UI; sign in with an account whose UID is in `ADMIN_USER_IDS`.

## API (admin only)

All admin API routes require `Authorization: Bearer <Firebase ID token>` and that the token’s UID is in `ADMIN_USER_IDS`.

- **`GET /api/admin/users`**  
  List Firebase Auth users.  
  Query: `search` (optional) – partial match on User ID, email, or display name.

- **`GET /api/admin/users/[userId]`**  
  One user: Auth record plus Firestore counts for `workouts`, `workoutCollections`, `workoutPlans` under `users/<userId>`.

## Security note

Admin check is done by UID allowlist (`ADMIN_USER_IDS`). For production you can instead set [custom claims](https://firebase.google.com/docs/auth/admin/custom-claims) (e.g. `admin: true`) and change `requireAdminAuth` in `src/lib/auth.ts` to require that claim.
