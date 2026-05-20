# Mapping fra prototype til Supabase/Postgres

Den gamle prototype bliver liggende som reference. Den gemmer data i `localStorage` under nøglen `stamdata-scheduler-v1`, og seed-data ligger i `window.SCHEDULE_SEED_DATA`.

## Prototypens hovedobjekter

| Prototype | Ny tabel | Bemærkning |
|---|---|---|
| `metadata` | `data_imports.metadata` | Gemmes som importspor pr. Excel-/prototype-import. |
| `teachers[]` | `teachers` | `id` gemmes som `legacy_id`, `name` som `initials`, `skills` som `skills_summary`. |
| `teachers[].skillDetails[]` | `teacher_competencies` | `subject` matches/opretter `course_subjects`; `level` bliver `primary`/`secondary`. |
| `teachers[].blockedDays[]` | `teacher_unavailable_days` | Dag 0-4 svarer til mandag-fredag. |
| `classes[]` | `class_groups` | `id` gemmes som `legacy_id`, `name` som holdnavn, `address` som `address_label`/campus. |
| Holdtype/kategori udledt af holdnavn eller Excel | `class_categories` + `class_groups.class_category_id` | Migration 002 gør Grundfag, Hovedforløb, Brobygning og AMU til redigerbare kategorier med underkategorier. |
| Uddannelsesplan/forløbstype | `education_programs` + `class_groups.education_program_id` | Bruges til at beskrive opskriften for et forløb, uafhængigt af det konkrete hold. |
| `classes[].preferredRoomId` | `class_groups.preferred_room_id` | Slås op via `rooms.legacy_id`. |
| `classes[].activeWeeks[]` | `class_active_weeks` | En række pr. aktiv uge. |
| `rooms[]` | `rooms` | `id` gemmes som `legacy_id`, `name` og `address` bevares. Migration 002 tilføjer valgfri `room_type_id`. |
| Lokaletype | `room_types` | Kan senere styre almindeligt lokale, værksted, IT-lokale osv. |
| `subjects[]` | `subject_offerings` | `id` gemmes som `legacy_id`; kobles til `class_groups` og `course_subjects`. |
| Fagopskrift pr. forløb/kategori/hold | `education_requirements` | Migration 002 beskriver forventede fag, timer, uger, modultype, lokaletype og kompetencekrav. |
| `subjects[].teacherIds[]` | `teaching_assignments` | En række pr. valgt lærer. Rækkefølgen gemmes i `assignment_order`. |
| `subjects[].suggestedTeacherIds[]` | `teacher_suggestions` | Bruges som importeret forslag, mens `teacher_competencies` er grundlaget. |
| `subjects[].pairingId` | `subject_pairing_groups` + `subject_offerings.pairing_group_id` | Understøtter sammenlæste fag i samme slot/lokale. |
| `bookings[]` | `lesson_bookings` | `week`, `day`, `block`, `subjectId`, `roomId`, evt. `teacherId`. Migration 002 tilføjer modul, låsning, kilde og generator-run. |
| Generatorforslag | `schedule_generation_runs` + `schedule_generation_suggestions` | Findes ikke i prototypen endnu; bruges til at gemme forslag før de accepteres som rigtige skemabrikker. |
| Officiel hovedforløbskalender | `official_hf_calendar_imports` + `official_hf_calendar_entries` | Importeres før almindelig skemagenerering og bliver senere til låste `lesson_bookings`. |
| `ui` | Ikke migreret | UI-state som aktiv fane og filter bør blive klient-state, ikke stamdata. |

## Faste konstanter

Prototypen har disse skemaregler i `CONFIG`:

| Prototype | Database |
|---|---|
| `blockHours: 1.5` | `schools.block_hours` |
| `maxWeek: 60` | `schools.max_week` |
| Standard organization/school | `organizations.slug = heg`, `schools.slug = heg` |
| `days` | `school_weekdays` |
| `blocks` | `school_blocks` |
| `blockPairs: [1,2], [3,4]` | `school_blocks.pair_no` |
| Formiddag/eftermiddag | `time_modules` + `time_module_blocks` |
| `subjectPriorities` | enum `subject_priority` |

Ved første seed bør der oprettes fem hverdage og fire blokke:

| Dag/blok | Værdi |
|---|---|
| Mandag-fredag | `day_of_week` 0-4 |
| Blok 1 | `block_no = 1`, `starts_at = 08:00`, `ends_at = 09:30`, `pair_no = 1` |
| Blok 2 | `block_no = 2`, `starts_at = 09:55`, `ends_at = 11:25`, `pair_no = 1` |
| Blok 3 | `block_no = 3`, `starts_at = 11:55`, `ends_at = 13:25`, `pair_no = 2` |
| Blok 4 | `block_no = 4`, `starts_at = 13:30`, `ends_at = 15:00`, `pair_no = 2` |

Migration 003 seeder disse standarddata. Migration 004 tilføjer `ends_at`, så import og generator fremover kan bruge både start- og sluttid direkte.

Migration 002 gør moduler eksplicit. Et standardseed kan fx oprette:

| Modul | Kobling |
|---|---|
| Formiddag | `module_type = morning`, blok 1 og 2 |
| Eftermiddag | `module_type = afternoon`, blok 3 og 4 |

## Excel-import

Den eksisterende `excel-importer.js` læser disse ark:

| Excel-ark | Database |
|---|---|
| `Lærerkompetencer` | `teachers`, `course_subjects`, `teacher_competencies` |
| `Hold og fag` | `class_categories`, `education_programs`, `class_groups`, `education_requirements`, `course_subjects`, `subject_offerings` |
| `Lokaler` | `campuses`, `room_types`, `rooms` |
| `Kalender` | `class_active_weeks`, evt. `class_groups.default_period_weeks` |
| `Fag og timer` | `education_requirements.total_hours`, `subject_offerings.total_hours`, `hours_source`, `hours_missing` |
| `Fagfordeling Aars/Hobro` | `teaching_assignments` |
| `Kalender 2023-2028 nyt forslag.xlsx` | `official_hf_calendar_imports`, `official_hf_calendar_entries`, evt. `import_warnings` |

Importen bør oprette én række i `data_imports` først. Alle importerede rækker kan derefter gemme `source_import_id`, så det senere er tydeligt, om en værdi kom fra Excel, prototype-seed eller manuel redigering.

Problemer fra importen bør gemmes i `import_warnings` i stedet for kun at blive vist midlertidigt i brugerfladen. Det gør det muligt at importere et delvist brugbart grundlag og efterfølgende rette manglende kategori, timetal, kompetence eller fagfordeling direkte i programmet.

## Konfliktregler

Prototypens konfliktlogik er repræsenteret i databasevisninger:

| Prototype-regel | Databasevisning |
|---|---|
| Lærer dobbeltbooket i samme uge/dag/blok | `v_booking_conflicts` med `teacher_double_booking` |
| Hold dobbeltbooket i samme uge/dag/blok | `v_booking_conflicts` med `class_double_booking` |
| Lokale dobbeltbooket i samme uge/dag/blok | `v_booking_conflicts` med `room_double_booking` |
| Sammenlæste fag må dele slot/lokale | Undtages via `subject_pairing_groups` |
| Hold aktivt i uge | `inactive_class_week` |
| Lærer har spærretid/fridag | `blocked_teacher_day` |
| Hold og lokale skal være på samme adresse/campus | `address_mismatch` |
| Blok skal ligge i par B1+B2 eller B3+B4 | `invalid_block_pair` |
| Fag må ikke have flere blokke end timebudget | `subject_budget_overflow` |
| Lærer må ikke skifte adresse mellem blokke i samme blokpar | `transport_between_campuses` |
| Manglende lærer/timetal/aktive uger | `v_subject_warnings` |

Migration 002 tilføjer planlægningsviews:

| View | Formål |
|---|---|
| `v_class_planning_status` | Viser hold uden kategori, uden aktive uger og med mangler i krav/fagfordeling/kompetencer. |
| `v_requirement_status` | Udvider fagkrav pr. relevant hold og viser manglende timetal, fag, fagfordeling og lærerkompetence. |
| `v_generation_ready_classes` | Viser om et hold er klar til skemagenerering, samt konkrete blocker-reasons. |

## Foreslået import-rækkefølge

1. Kør migration 003 og 004, så HEG-organization, HEG-school, hverdage, blokke, moduler, holdkategorier, lokalityper, startprogrammer, slugs og blok-sluttider findes før import.
2. Kør migration 005, så officielle HF-kalendertabeller findes.
3. Importér `Kalender 2023-2028 nyt forslag.xlsx` til `official_hf_calendar_entries`.
4. Opret `data_imports` for den konkrete stamdata-/Excel-import.
5. Opret `campuses` ud fra klasse-/lokaleadresser (`Aars`, `Hobro` osv.).
6. Upsert `teachers`, `rooms`, `class_groups` via `legacy_id`.
7. Kobl `rooms` til `room_types`, hvor importen eller brugerens valg gør det muligt.
8. Kobl `class_groups` til seedede `class_categories` og `education_programs`.
9. Opret `course_subjects` ud fra alle fag-navne og kompetence-fag.
10. Opret `teacher_competencies`.
11. Opret `class_active_weeks`.
12. Opret eller opdater `education_requirements` som opskrift for forløb/kategori/hold.
13. Opret `subject_pairing_groups` for eksisterende `pairingId`.
14. Opret `subject_offerings`.
15. Opret `teaching_assignments` og `teacher_suggestions`.
16. Opret låste `lesson_bookings` fra officielle HF-poster med `source = official_hf_calendar`, `locked = true` og `official_hf_calendar_entry_id`.
17. Opret øvrige `lesson_bookings`, hvis prototype-exporten indeholder planlagte blokke.
18. Gem usikre eller mangelfulde Excel-rækker i `import_warnings`.

## Bevidste valg

- Prototypens gamle `id`-værdier bliver ikke brugt som primærnøgler. De gemmes som `legacy_id`, mens databasen bruger UUID.
- Fag er delt i `course_subjects` og `subject_offerings`, så "Dansk C" kun findes én gang som fagtype, men kan udbydes på mange hold.
- Migration 002 lægger `education_requirements` ind mellem uddannelsesplan og konkrete fagudbud. Det gør det muligt først at beskrive, hvad et hold skal have, og bagefter se om de konkrete `subject_offerings` og `teaching_assignments` opfylder opskriften.
- `teacherId`, `coTeacherId` og `isSplit` fra prototypen erstattes af `teaching_assignments`. Det gør delt undervisning mere fleksibel end kun én medlærer.
- `teacher_competencies.level` er udvidet med `certified`, så krav kan skelne mellem sekundær, primær og certificeret kompetence.
- Generatoren bør fremover planlægge på `time_modules` først og derefter blokke. For grundforløb kan reglen "helst to forskellige fag pr. dag" gemmes som kategoriens `planning_profile` eller som generatorparameter i `schedule_generation_runs.parameters`.
- Officielle hovedforløb importeres som kalenderposter først og skal senere blive til låste bookinger, så generatoren planlægger udenom dem.
- `ui` migreres ikke, fordi filtrering, aktiv uge og aktiv fane hører til appens brugerflade.
