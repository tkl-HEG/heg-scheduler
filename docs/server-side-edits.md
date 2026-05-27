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

Samme sikkerhedsmodel bruges til admin-redigering af lærer-årstimer på `/admin/opgaveoversigt`: owner/admin/editor kan ændre `allocated_hours`, mens ikke-loggede brugere og `viewer` ser read-only fallback. Ændringer sendes til `PATCH /api/admin/teacher-workload-allocations`, som kræver bearer token, rollechecker server-side og skriver before/after audit i `data_change_log`.

`/admin/fag` bruger også samme model til `course_subjects`: owner/admin/editor kan oprette fag, redigere `name`/`normalized_key` og deaktivere/genaktivere fag via `/api/admin/course-subjects`. Route handleren kræver `Authorization: Bearer <access_token>`, finder skolens organisation, genbruger rollechecket og skriver `insert`/`update` audit-rækker i `data_change_log` med `table_name = course_subjects`, `before_data` og `after_data`.

Migration `018_course_subject_lifecycle.sql` tilføjer `is_active`, `archived_at`, `archived_by` og `archived_reason` til `course_subjects`. Deaktivering er soft lifecycle: route handleren sætter `is_active = false` og arkivfelterne, men hard-deleter aldrig faget. Genaktivering nulstiller arkivfelterne og sætter `is_active = true`. Hvis migrationen ikke er kørt endnu, viser UI read-only fallback for deaktivering.

Opret fag finder `school_id` robust: først fra `schools`, dernæst aktivt `workload_years.school_id`, og til sidst fra eksisterende `course_subjects.school_id`, hvis fagene kun peger på én skole. Det gør opret-flowet uafhængigt af om `schools` er læsbart for anon/read-only klienten.

`/admin/hold` bruger samme model til `class_groups`: owner/admin/editor kan oprette hold, redigere stamfelter og deaktivere/genaktivere hold via `/api/admin/holds`. Route handleren kræver bearer token, finder skolens organisation, genbruger rollechecket og skriver `insert`/`update` audit-rækker i `data_change_log` med `table_name = class_groups`, `before_data` og `after_data`.

Migration `019_hold_lifecycle.sql` tilføjer `is_active`, `archived_at`, `archived_by` og `archived_reason` til `class_groups`. Deaktivering er soft lifecycle og hard-deleter aldrig hold. Opret hold finder `school_id` robust på samme måde som `/admin/fag`: `schools`, aktivt `workload_years.school_id` og til sidst ensartet `class_groups.school_id`.

Hold er stamdata. `/admin/hold` må ikke oprette campus-specifikke fag eller fagudbud pr. hold. Den nuværende datamodel har `subject_offerings.class_group_id`, altså ét hold pr. fagudbud. Sammenlæsning mellem fx HGF2EUD og HGF2EUX i samme fag skal derfor senere håndteres i en udvidet fagudbud/undervisningsgruppe-model, hvor ét fagudbud kan kobles til flere hold.

Migration `020_subject_offering_class_groups.sql` opretter fundamentet for den model med join-tabellen `subject_offering_class_groups`. Tabellen kobler flere `class_groups` til samme `subject_offering`, mens `subject_offerings.class_group_id` bevares som legacy/primært hold, så eksisterende views, imports og read-only sider ikke knækker. Eksisterende `subject_offerings` backfilles til join-tabellen med `member_role = primary`, `sort_order = 1` og metadata om at rækken kommer fra `subject_offerings.class_group_id`.

Der er stadig ingen UI-write til fagudbud/undervisningsgrupper. Næste fase bør være en server-side `/admin/fagudbud` eller `/admin/undervisningsgrupper` model, som skriver medlemsændringer kontrolleret, audit-logger dem og derefter opdaterer relevante read views for krav, status og planlægning.

Admin workload-rækker vises primært fra `v_teacher_workload_status`. `teachers`, `workload_years` og `teacher_workload_allocations` bruges til at berige rækkerne med write-UUID’er og eksisterende `allocated_hours`. Rækker uden gyldigt `teacher_id` eller `workload_year_id` vises stadig, men Gem er disabled for den række.

Gem på `/admin/opgaveoversigt` aktiveres kun for rækker med gyldige UUID’er i `teacher_id` og `workload_year_id`, write-adgang og et gyldigt timetal. Klienten sender kun `teacher_id`, `workload_year_id` og `allocated_hours` til server-routen og falder aldrig tilbage til initialer eller navn som id. `Rest` beregnes lokalt fra den aktuelle inputværdi som `allocated_hours - assigned_hours_known - assigned_hours_missing`, så tallet opdateres med det samme og efter gem.

Inputværdien i tabellen holdes adskilt fra den gemte/committed værdi. UI markerer først “Sidst gemt” og opdaterer den committed `allocated_hours`, når `PATCH /api/admin/teacher-workload-allocations` svarer OK. Hvis serveren returnerer 400/403/500, beholdes inputværdien som kladde, men rækken markeres ikke som gemt. Rækker uden UUID kan fortsat ses, men kan ikke gemmes.

UUID-valideringen for workload gem bruger Postgres UUID-formatet `8-4-4-4-12` hextegn. Den må ikke kræve en bestemt UUID-version eller variant, fordi eksisterende database-id’er kan være gyldige Postgres UUID’er uden at matche en snæver RFC-version/variant-regex.

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
- Ingen hard delete af fag på `/admin/fag`; deaktivering bruger `is_active=false` og arkivfelter fra migration 018.
- Ingen hard delete af hold på `/admin/hold`; deaktivering bruger `is_active=false` og arkivfelter fra migration 019.
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
