# Server-side edits

Dette dokument beskriver modellen for redigering af lærerkompetencer. `/admin/kompetencer` bruger stadig read-only fallback for viewer og ikke-loggede brugere, men UI-write er nu aktiveret for owner/admin/editor via den kontrollerede server-route.

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

## Login/status-flow

`/admin/status` er login- og rollekontrolsiden. Den viser stadig status, men kompetence-redigering afhænger nu af write-adgang i `organization_members`.

Status efter test: email-kode-login via Resend/Supabase virker. Brugere med `owner`, `admin` eller `editor` kan redigere lærerkompetencer, og add/remove skriver audit-rækker i `data_change_log`. Ikke-loggede brugere og `viewer` forbliver read-only.

Browserdelen bruger `lib/supabaseBrowser.ts` med kun:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Anbefalet login sker nu med Supabase email OTP-kode via `signInWithOtp` og `verifyOtp`. Der hardcodes ingen passwords, og service role key importeres ikke i client components.

Koden sendes med:

```ts
supabase.auth.signInWithOtp({
  email: trimmedEmail,
  options: {
    shouldCreateUser: false
  }
})
```

Koden bekræftes med:

```ts
supabase.auth.verifyOtp({
  email: trimmedEmail,
  token: trimmedToken,
  type: "email"
})
```

Efter `verifyOtp` henter `/admin/status` sessionen med `supabase.auth.getSession()` og kalder derefter `GET /api/admin/status` med `Authorization: Bearer <access_token>`.

Magic-link callback findes stadig som fallback, men kan fejle i Outlook/Microsoft-mailmiljøer, fordi link-scanning kan åbne linket først eller fjerne URL-fragmenter.

Hvis magic-link fallback bruges igen senere, skal redirect sættes sådan:

```ts
options: {
  emailRedirectTo: window.location.origin + "/auth/callback?next=/admin/status"
}
```

Hvis magic-linket lander på forsiden med auth-hash, sender en lille root-fallback brugeren videre til `/auth/callback?next=/admin/status` med samme hash, så callback kan behandles ét sted.

Når brugeren er logget ind, kalder siden `GET /api/admin/status` med `Authorization: Bearer <access_token>`. Route handleren kører server-side, validerer tokenet, slår organization `heg` op og returnerer aktiv rolle i `organization_members`. `owner`, `admin` og `editor` vises som write-adgang; `viewer` eller manglende rolle vises som ingen write-adgang.

Siden er kun status og login/logout. UI-write på `/admin/kompetencer` afhænger fortsat af sessionen og rollechecket fra `/api/admin/status`.

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

## Route handler

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

Route handleren er nu koblet til UI for owner/admin/editor via `/admin/kompetencer`. Den skal stadig være server-side only, og hvis vi senere udvider write-flowet, bør den endelige databaseændring og audit-log samles i en Postgres RPC/transaktion, så der ikke kan opstå en kompetenceændring uden audit-række.

## Hvad vi stadig ikke gør

- Ingen write-knapper for viewer eller ikke-loggede brugere på `/admin/kompetencer`.
- Ingen anon insert/update/delete policies.
- Ingen service role key i client components.
- Ingen ændringer til `lesson_bookings`.
- Ingen generator-flow.

## Magic-link callback

`/auth/callback` håndterer nu Supabase magic-link callback i browseren ved at:

- bruge `emailRedirectTo` til `/auth/callback?next=/admin/status`
- udveksle `code` via `exchangeCodeForSession`
- understøtte session-data i URL-hash med `setSession`
- rydde callback-parametre fra URL med `history.replaceState`
- hente session igen med `supabase.auth.getSession()`
- videresende til `next`, normalt `/admin/status`, når sessionen er oprettet
