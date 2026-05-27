# Scheduler v2

Denne mappe er oprettet som næste version af skemalægningsværktøjet. Den eksisterende prototype i roden er ikke ændret.

Indhold:

- `supabase/migrations/001_initial_schema.sql` - første Supabase/Postgres schema.
- `supabase/migrations/002_planning_workflow_schema.sql` - udvider schemaet med holdkategorier, uddannelsesplaner, krav, moduler, generator-runs, forslag og importadvarsler.
- `supabase/migrations/003_seed_core_planning_data.sql` - seeder HEG-standarddata: organization, school, hverdage, blokke, formiddag/eftermiddag, holdkategorier, lokalityper og startprogrammer.
- `supabase/migrations/004_schema_hardening.sql` - gør schemaet mere robust med stabile slugs på organization/school og eksplicitte sluttider på skemablokke.
- `supabase/migrations/005_official_hf_calendar_schema.sql` - tilføjer officiel hovedforløbskalender, så HF-forløb kan importeres, låses og planlægges udenom.
- `supabase/migrations/006_general_planning_calendar_schema.sql` - tilføjer generelle planlægningskalendere for GF1, GF2, STÅ og vigtige datoer.
- `supabase/migrations/007_staa_common_program.sql` - tilføjer fælles STÅ-program og STÅ-kategori for forskudte STÅ1/STÅ2-kohorter.
- `supabase/migrations/009_add_lsss_jhm_teachers.sql` - manuel stamdatarettelse: tilføjer LSSS som selvstudiumsressource og JHM som lærer med kompetence i Arbejdsmarkedsparathed, hvis faget findes.
- `supabase/migrations/010_teacher_workload_planning.sql` - tilføjer årlig opgaveoversigt, halvårsperioder og et første view til lærerbelastning.
- `supabase/migrations/011_fix_workload_period_dates.sql` - retter halvårsperioderne for `2026/2027`, så efteråret går ca. to uger ind i januar.
- `supabase/migrations/012_readonly_workload_policies.sql` - giver read-only anon-adgang til opgaveoversigt-tabeller og workload-statusviewet.
- `supabase/migrations/013_seed_teacher_workload_allocations.sql` - seeder midlertidige årsnormer for `2026/2027`: 750 timer som standard, JHM 100, CNH 350 og LSSS 0.
- `supabase/migrations/018_course_subject_lifecycle.sql` - tilføjer soft lifecycle til fag med `is_active` og arkivfelter til `/admin/fag`.
- `supabase/migrations/019_hold_lifecycle.sql` - tilføjer soft lifecycle til hold med `is_active` og arkivfelter til `/admin/hold`.
- `supabase/migrations/020_subject_offering_class_groups.sql` - opretter join-tabellen, så ét fagudbud kan kobles til flere hold.
- `supabase/migrations/021_subject_offering_lifecycle.sql` - tilføjer soft lifecycle til fagudbud med `is_active` og arkivfelter til `/admin/fagudbud`.
- `scripts/import-official-hf-calendar.mjs` - parser `Kalender 2023-2028 nyt forslag.xlsx` med dry-run og Supabase-import.
- `scripts/import-planning-calendars.mjs` - parser GF1/GF2/STÅ Excel-udkast og DOCX med vigtige datoer med dry-run og senere Supabase-import.
- `scripts/import-stamdata.mjs` - parser prototype- og Excel-stamdata med dry-run og senere Supabase-import.
- `docs/prototype-data-mapping.md` - mapping fra prototypens `localStorage`/Excel-data til databasen.
- `docs/official-hf-calendar-import.md` - detaljer om import af officiel hovedforløbskalender.
- `docs/planning-calendar-import.md` - detaljer om import af generelle planlægningskalendere.
- `docs/stamdata-import.md` - detaljer om import af lærere, hold, fag, kompetencer og fagfordeling.

Fokus er datalaget: stamdata, skemabrikker, importspor, konfliktregler og den egentlige planlægningsarbejdsgang fra holdafklaring til udrulning.

## Officiel hovedforløbskalender

Den officielle HF-kalender skal importeres før almindelig skemagenerering. Når kalenderposter senere bliver til `lesson_bookings`, skal de som udgangspunkt have `source = official_hf_calendar`, `locked = true` og `official_hf_calendar_entry_id` sat.

Dry-run kræver kun Excel-filen:

```bash
node scheduler-v2/scripts/import-official-hf-calendar.mjs "Kalender 2023-2028 nyt forslag.xlsx" --dry-run
```

Rigtig import kræver Supabase-adgang:

```bash
set SUPABASE_URL=https://your-project.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
node scheduler-v2/scripts/import-official-hf-calendar.mjs "Kalender 2023-2028 nyt forslag.xlsx"
```

Scriptet bruger `ORGANIZATION_SLUG=heg` og `SCHOOL_SLUG=heg` som standard. Det bruger npm-pakken `xlsx`, hvis den findes, og falder ellers tilbage til prototypens `xlsx.full.min.js` i projektroden.

## Generel planlægningskalender

GF1, GF2, STÅ og vigtige datoer importeres som `planning_calendar_events`. De bruges som blockers, deadlines og milepæle for generatoren, men de bliver ikke automatisk til `lesson_bookings`.

Dry-run:

```bash
node scheduler-v2/scripts/import-planning-calendars.mjs --dry-run
```

Fra `scheduler-v2`-mappen:

```bash
node .\scripts\import-planning-calendars.mjs --dry-run
```

Rigtig import er først til senere og kræver `SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY`.

## Stamdata

Stamdata-importen samler lærere, lærerkompetencer, lokaler, hold, aktive uger, fag, fagkrav, fagudbud, fagfordeling, lærerforslag og sammenlæsningsgrupper fra prototypens `seed-data.js` og Excel-grunddata.

Migration 007 skal være kørt før rigtig stamdataimport, så Studenteråret kan mappe til fælles `staa` i stedet for at blive hårdkodet som `staa1` eller `staa2`.

Dry-run:

```bash
node scheduler-v2/scripts/import-stamdata.mjs --dry-run
```

Fra `scheduler-v2`-mappen:

```bash
node .\scripts\import-stamdata.mjs --dry-run
```

Rigtig import kræver `SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY`, men skal først køres efter dry-run er vurderet. Stamdata-importen opretter ikke skemabrikker; den forbereder datagrundlaget for senere generator og manuel redigering.

Se også `docs/stamdata-import.md`.

## Read-only webapp

Den første Next.js-app ligger direkte i `scheduler-v2` og viser importerede data uden at oprette eller ændre skemabrikker.

Miljøvariabler:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Lokal kørsel fra `scheduler-v2`:

```bash
npm install
npm run dev
```

Appen har siderne `/`, `/importstatus`, `/hold`, `/laerere`, `/fagudbud`, `/kalendere`, `/staa-review`, `/admin/kompetencer`, `/admin/opgaveoversigt`, `/admin/fag`, `/admin/hold`, `/admin/fagudbud` og `/admin/status`.

`/admin/kompetencer` er en guarded adminside for lærerkompetencer. Email-kode-login via Resend/Supabase virker, og `owner`, `admin` og `editor` kan redigere kompetencer; add/remove skrives til `data_change_log` som audit. Ikke-loggede brugere og `viewer` ser siden read-only.

`/admin/opgaveoversigt` bruger samme sikkerhedsmodel til lærer-årstimer: `owner`, `admin` og `editor` kan redigere `allocated_hours`, mens ikke-loggede brugere og `viewer` er read-only. Ændringer sker server-side og audit-logges med before/after i `data_change_log`.

`/admin/fag` bruger samme server-side sikkerhedsmodel til `course_subjects`: `owner`, `admin` og `editor` kan oprette fag, redigere `name`/`normalized_key` og deaktivere/genaktivere fag, mens ikke-loggede brugere og `viewer` er read-only. Ændringer skrives via `/api/admin/course-subjects` og audit-logges i `data_change_log`. Migration `018_course_subject_lifecycle.sql` skal køres i Supabase for at tilføje `is_active`, `archived_at`, `archived_by` og `archived_reason`; deaktivering er soft lifecycle og aldrig hard delete.

`/admin/hold` redigerer hold-stamdata i `class_groups`: `owner`, `admin` og `editor` kan oprette, redigere, deaktivere og genaktivere hold via `/api/admin/holds`; ikke-loggede brugere og `viewer` er read-only. Migration `019_hold_lifecycle.sql` skal køres i Supabase for soft lifecycle på hold. Hold opretter ikke fag eller fagudbud.

`/admin/fagudbud` redigerer fagudbud/undervisningsgrupper i `subject_offerings`: `owner`, `admin` og `editor` kan oprette fagudbud, vælge fag fra `course_subjects`, vælge ét eller flere hold fra `class_groups`, redigere timer/periodefelter og deaktivere/genaktivere via `/api/admin/subject-offerings`. Ikke-loggede brugere og `viewer` er read-only. Alle writes sker server-side med bearer-token, rollecheck og audit-log i `data_change_log`.

Migration `020_subject_offering_class_groups.sql` opretter `subject_offering_class_groups` som databasefundament for sammenlæsning: ét `subject_offering` kan kobles til flere `class_groups`. Eksisterende `subject_offerings.class_group_id` bevares som legacy/primært hold, og eksisterende fagudbud backfilles med én `primary` medlemsrække. Ved opret med flere hold oprettes ét `subject_offering`, `class_group_id` sættes til det første valgte hold, og join-tabellen får en række pr. hold. Sammenlæsning håndteres altså som flere hold på samme fagudbud, ikke som campus-specifikke stamfag.

Migration `021_subject_offering_lifecycle.sql` tilføjer `is_active`, `archived_at`, `archived_by` og `archived_reason` til `subject_offerings`. Deaktivering på `/admin/fagudbud` er soft lifecycle og aldrig hard delete. Ændringer i selve fagudbuddet audit-logges med `table_name = subject_offerings`; ændringer i holdtilknytninger audit-logges med `table_name = subject_offering_class_groups` og before/after snapshots.

Se `docs/server-side-edits.md` for den planlagte server-only write-model og Vercel environment variables.

Hvis Supabase RLS blokerer læsning med anon key, viser appen en fejlbesked på siden. Se `docs/app-dashboard.md` for anbefalede næste trin.

## Vercel deploy

Projektet kan deployes til Vercel som en Next.js-app.

1. Opret et GitHub repo og commit `scheduler-v2`.
2. Kontroller at `.env.local`, `.next` og `node_modules` ikke er med i commit.
3. Importér repoet i Vercel.
4. Hvis repoet også indeholder den gamle prototype, så sæt Vercel Root Directory til `scheduler-v2`.
5. Sæt miljøvariablerne:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Service role key må ikke bruges i frontend eller sættes som public Vercel-variable.

Se også `docs/vercel-deploy.md`.
