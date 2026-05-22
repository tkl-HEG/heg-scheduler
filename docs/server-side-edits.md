# Server-side edits

Dette dokument beskriver den anbefalede model for senere redigering af lærerkompetencer. Modellen er ikke koblet på UI endnu, og `/admin/kompetencer` forbliver read-only.

## Placering

- Read-only visninger bruger fortsat `lib/supabase.ts` med `NEXT_PUBLIC_SUPABASE_URL` og `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Server-side writes skal bruge `lib/supabaseServer.ts`.
- `lib/supabaseServer.ts` importerer `server-only`, så den ikke kan bruges fra client components.
- Den konkrete kompetenceændring bør senere ligge i en Next.js route handler eller server action, fx under `app/admin/kompetencer/actions.ts` eller `app/api/admin/competencies/route.ts`.

## Environment variables

Sæt disse i Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`: public Supabase URL til read-only appen.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public anon key til read-only appen.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key til kontrollerede server writes.
- `SUPABASE_URL`: valgfri server-only URL. Hvis den ikke sættes, bruger server-helperen `NEXT_PUBLIC_SUPABASE_URL` som URL.

`SUPABASE_SERVICE_ROLE_KEY` må aldrig have `NEXT_PUBLIC_` prefix og må ikke importeres i client components.

## Write flow for lærerkompetencer

Den senere write-sti bør gøre dette i rækkefølge:

1. Modtag ændringen i en server action eller route handler.
2. Læs brugerens Supabase Auth session fra requesten.
3. Afvis requesten, hvis brugeren ikke er logget ind.
4. Kontroller brugerens rolle i `organization_members`; tillad kun fx `owner`, `admin` eller `editor`.
5. Valider input: `teacher_id`, `course_subject_id`, ønsket handling og evt. `level`.
6. Find eksisterende række i `teacher_competencies` som `before_data`.
7. Opret, opdater eller slet kompetencen server-side.
8. Skriv audit-række i `data_change_log` med `before_data`, `after_data`, `changed_by`, `source = app` og metadata om UI-flowet.
9. Returner et lille resultat til UI'et.

Selve ændringen og audit-rækken bør ske i én samlet databasehandling. Den mest robuste løsning er en Postgres RPC, som kører transaktionelt og kaldes fra serveren efter auth- og rollecheck.

## changed_by

`changed_by` bør sættes fra den validerede Supabase Auth bruger:

- Brug `user.id`, når det findes.
- Brug brugerens email som fallback.
- Brug kun `server` til systemhandlinger uden menneskelig bruger.

Helperen `changedByFromActor` i `lib/supabaseServer.ts` giver den fallback-regel, men den erstatter ikke auth- og rollecheck.

## Audit-log

`data_change_log` er append-only audit-fundamentet for appændringer.

For lærerkompetencer bør audit-rækken bruge:

- `table_name = teacher_competencies`
- `record_id = teacher_competencies.id`, når rækken findes
- `change_type = competency_add`, `competency_remove` eller `update`
- `before_data`: JSON snapshot før ændringen
- `after_data`: JSON snapshot efter ændringen
- `changed_by`: auth user id/email
- `source = app`
- `metadata`: fx `route`, `teacher_id`, `course_subject_id` og UI-kontekst

## Hvad vi ikke gør endnu

- Ingen aktive write-knapper på `/admin/kompetencer`.
- Ingen anon insert/update/delete policies.
- Ingen service role key i client components.
- Ingen ændringer til `lesson_bookings`.
- Ingen generator-flow.
