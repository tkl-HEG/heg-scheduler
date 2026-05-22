# Server-side edits

Dette dokument beskriver den anbefalede model for senere redigering af lærerkompetencer. Modellen er ikke koblet på UI endnu, og `/admin/kompetencer` forbliver read-only.

## Placering

- Read-only visninger bruger fortsat `lib/supabase.ts` med `NEXT_PUBLIC_SUPABASE_URL` og `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Server-side writes skal bruge `lib/supabaseServer.ts`.
- `lib/supabaseServer.ts` importerer `server-only`, så den ikke kan bruges fra client components.
- Auth- og rollecheck til admin-writes ligger i `lib/adminAuth.ts`.
- Den konkrete kompetenceændring bør senere ligge i en Next.js route handler eller server action, fx under `app/admin/kompetencer/actions.ts` eller `app/api/admin/competencies/route.ts`.

## Environment variables

Sæt disse i Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`: public Supabase URL til read-only appen.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public anon key til read-only appen.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key til kontrollerede server writes.

`SUPABASE_SERVICE_ROLE_KEY` må aldrig have `NEXT_PUBLIC_` prefix og må ikke importeres i client components.

`SUPABASE_URL` kan sættes som valgfri server-only URL, men server-helperen kan også bruge `NEXT_PUBLIC_SUPABASE_URL` som URL.

## Auth- og rollemodel

`organization_members` findes allerede fra det oprindelige schema. Migration `017_admin_auth_roles.sql` udvider tabellen til den praktiske admin-model med `id`, `email`, `is_active`, `updated_at` og `metadata`, uden at give anon write access.

Roller:

- `owner`: fuld administrativ adgang.
- `admin`: administrativ adgang.
- `editor`: må bruge fremtidige kontrollerede write-flows.
- `viewer`: må kun læse.

Server-side writes må kun fortsætte for aktive medlemskaber med `owner`, `admin` eller `editor`.

Migration `017_admin_auth_roles.sql` forbereder også en initial owner for `tkl@heguddannelser.dk` i organisationen `heg`. Hvis organisationen ikke findes, skriver migrationen en notice og stopper uden hard crash. Hvis Auth-brugeren ikke findes endnu, oprettes en email-only placeholder, så den kan matches via email, indtil `user_id` bliver koblet.

Anon får ikke insert/update/delete på `organization_members`, og `data_change_log` har fortsat ingen anon/authenticated write policies.

## Write flow for lærerkompetencer

Den senere write-sti bør gøre dette i rækkefølge:

1. Modtag ændringen i en server action eller route handler.
2. Læs brugerens Supabase Auth session fra requestens `Authorization: Bearer <access_token>`.
3. Afvis requesten, hvis brugeren ikke er logget ind.
4. Kontroller brugerens rolle i `organization_members`; tillad kun fx `owner`, `admin` eller `editor`.
5. Valider input: `teacher_id`, `course_subject_id`, ønsket handling og evt. `level`.
6. Find eksisterende række i `teacher_competencies` som `before_data`.
7. Opret, opdater eller slet kompetencen server-side.
8. Skriv audit-række i `data_change_log` med `before_data`, `after_data`, `changed_by`, `source = app` og metadata om UI-flowet.
9. Returner et lille resultat til UI'et.

Selve ændringen og audit-rækken bør ske i én samlet databasehandling. Den mest robuste løsning er en Postgres RPC, som kører transaktionelt og kaldes fra serveren efter auth- og rollecheck.

## changed_by

`changed_by` sættes fra den validerede Supabase Auth bruger:

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

## Første route handler

Den første server-side route handler ligger i `app/api/admin/teacher-competencies/route.ts`.

Den accepterer kun `POST` med JSON:

```json
{
  "action": "add",
  "teacher_id": "uuid",
  "course_subject_id": "uuid",
  "level": "primary"
}
```

`action` kan være `add` eller `remove`, og `level` er valgfri med default `primary`.

Route handleren:

- bruger `lib/supabaseServer.ts`
- kræver Supabase Auth bearer token
- kræver aktivt `organization_members` medlemskab med `owner`, `admin` eller `editor`
- validerer `teacher_id` og `course_subject_id` som UUID
- kontrollerer at lærer og fag findes og hører til samme skole
- indsætter eller sletter i `teacher_competencies`
- skriver audit-række i `data_change_log`
- sætter `changed_by` fra den validerede Auth bruger
- returnerer JSON med `success`, `status` eller `error`

Route handleren må stadig ikke kobles til UI, før Auth + rollecheck er testet end-to-end på Vercel. Når UI-write skal aktiveres, bør den endelige databaseændring og audit-log samles i en Postgres RPC/transaktion, så der ikke kan opstå en kompetenceændring uden audit-række.

## Hvad vi ikke gør endnu

- Ingen aktive write-knapper på `/admin/kompetencer`.
- Ingen anon insert/update/delete policies.
- Ingen service role key i client components.
- Ingen ændringer til `lesson_bookings`.
- Ingen generator-flow.
