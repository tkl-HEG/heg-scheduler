# Redigering af lærerkompetencer

Første version af `/admin/kompetencer` er read-only. Den viser lærere, fag, eksisterende kompetencer og en disabled checkbox-preview, så vi kan godkende formen, før der åbnes for ændringer.

## Anbefalet sikkerhedsmodel

Writes bør ske sådan:

1. Brug Supabase Auth, så brugeren er logget ind.
2. Brug `organization_members` eller en tilsvarende rollemodel til at afgøre, om brugeren er `owner`, `admin` eller `editor`.
3. Frontend må kun bruge `NEXT_PUBLIC_SUPABASE_URL` og `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Kompetenceændringer sendes til en Next.js server action eller route handler.
5. Serveren validerer session og rolle, før noget ændres.
6. Hvis service role key bruges, må den kun ligge som server-side Vercel environment variable uden `NEXT_PUBLIC_`.
7. Selve ændringen bør ske i en samlet databasehandling, så ændringen i `teacher_competencies` og audit-rækken i `data_change_log` lykkes eller fejler sammen.
8. Anon får ikke insert/update/delete policies.

Den mest robuste næste fase er en Postgres RPC eller server-side route, der:

- finder eksisterende kompetence som `before_data`
- opretter, opdaterer eller sletter `teacher_competencies`
- skriver `after_data`
- indsætter en række i `data_change_log`
- returnerer et lille resultat til UI'et

## Audit-log

Migration `016_data_change_log.sql` opretter `data_change_log`.

Feltet bruges sådan:

- `table_name`: fx `teacher_competencies`
- `record_id`: id på kompetencerækken, når den findes
- `change_type`: `insert`, `update`, `delete`, `upsert`, `competency_add` eller `competency_remove`
- `before_data`: JSON før ændringen
- `after_data`: JSON efter ændringen
- `changed_by`: bruger-id eller email fra auth
- `source`: som standard `app`
- `metadata`: ekstra kontekst, fx begrundelse eller UI-flow

Tabellen har RLS slået til og ingen anon write policies.

## Første UI

`/admin/kompetencer` viser lærere, fag og eksisterende kompetencer med disabled checkboxes. Siden skriver ikke data og har ingen gem-knapper.
