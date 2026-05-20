# Første app-dashboard

Next.js-appen i `scheduler-v2` er første read-only visning af de importerede data. Den bruger kun Supabase anon key i frontend/server components og må ikke bruge service role key.

## Sider

- `/` viser nøgletal for lærere, hold, lokaler, fag, fagudbud, fagkrav, kompetencer, fagfordeling, kalendere og importwarnings.
- `/importstatus` viser seneste imports og warnings grupperet efter type/severity.
- `/hold` viser hold, kategori, uddannelsesprogram, adresse, aktive uger, antal fagudbud og warning count.
- `/laerere` viser lærere, kompetenceantal og antal fagfordelinger.
- `/fagudbud` viser fagudbud med timer, manglende timer, fagfordelte lærere og lærerforslag.
- `/kalendere` viser officiel hovedforløbskalender og generel planlægningskalender grupperet efter uge.
- `/staa-review` viser Studenteråret Aars/Hobro med fælles `staa` program, mulige kohorter og sammenlæsningsnøgle.

## Datagrænse

Appen opretter eller ændrer ikke `lesson_bookings`. Den læser heller ikke med service role key. Senere generator og booking-konvertering skal bygges som særskilte arbejdsgange.

## Supabase og RLS

Appen læser med:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Hvis tabellerne ikke vises, er den sandsynlige årsag RLS. De nuværende policies er skole-/medlemsbaserede, så anonym læsning kan være blokeret. Mulige næste trin er enten:

- login og medlemskobling via `organization_members`
- read-only views med passende policies
- eksplicit anon-read policy for udvalgte dashboard-views, hvis data må være offentligt tilgængelige

## Lokal kørsel

Opret `.env.local` i `scheduler-v2`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Installer pakker og start lokalt:

```bash
npm install
npm run dev
```

Åbn derefter `http://localhost:3000`.

## Vercel

Til første deploy skal de samme to miljøvariabler sættes i Vercel. Service role key må ikke lægges i Vercel-frontendmiljøet.
