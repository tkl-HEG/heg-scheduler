# Vercel deploy

Denne app kan deployes til Vercel som en almindelig Next.js-app. Den er read-only og må kun bruge Supabase anon/publishable key.

## Før deploy

- `.env.local` må ikke committes.
- `SUPABASE_SERVICE_ROLE_KEY` må ikke lægges i frontend eller Vercel-projektets public miljø.
- Appen opretter ikke `lesson_bookings` og indeholder ingen generator.
- Migration `008_readonly_dashboard_policies.sql` skal være kørt i Supabase, hvis dashboardet skal kunne læse med anon key.

## GitHub

1. Opret et GitHub repo.
2. Commit `scheduler-v2`-appen og dokumentationen.
3. Kontroller før commit, at `.env.local`, `.next` og `node_modules` ikke er staged.

## Vercel

1. Gå til Vercel og vælg **Add New Project**.
2. Importér GitHub repoet.
3. Hvis repo-roden er projektroden, sæt Root Directory til `scheduler-v2`.
4. Framework preset skal være **Next.js**.
5. Build command kan være `npm run build`.

## Environment variables

Sæt disse i Vercel:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Brug ikke service role key i Vercel-frontendmiljøet.

## Efter deploy

Åbn:

- `/`
- `/debug/supabase`
- `/kalendere`
- `/tilstedevaerelse`

Hvis `/debug/supabase` viser 0 eller fejl på counts, er det typisk RLS/policies eller miljøvariablerne i Vercel.
