# Finance OS Cloud Sync Phase 1

This build adds Supabase shared household sync for Carl + Kim testing.

## One-time Supabase setup

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Open `supabase/schema.sql` from this project.
4. Paste it into SQL Editor and run it once.

This creates:

- `households`
- `household_members`
- `household_state`
- `action_log`
- `state_snapshots`
- RLS policies
- invite-code helper functions

## App flow

1. Open the app.
2. Go to **Setup → Cloud household sync**.
3. Carl creates an account/signs in.
4. Carl clicks **Create cloud household** from the main device.
5. Copy the invite code.
6. Kim creates an account/signs in on her phone.
7. Kim enters the invite code and joins the household.
8. Both devices now pull/push the same household state.

## Safety rules

- The app still does not move money.
- Backups remain important.
- Use **Download full backup** for rollback.
- If two devices edit at the same time, the app will ask the older device to pull the latest cloud revision before saving again.

## Vercel

The current testing Supabase URL and anon key are included in the frontend config. If you move to a different Supabase project, set these Vercel environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
