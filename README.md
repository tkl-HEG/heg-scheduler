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

Appen har siderne `/`, `/importstatus`, `/hold`, `/laerere`, `/fagudbud`, `/kalendere` og `/staa-review`.

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
