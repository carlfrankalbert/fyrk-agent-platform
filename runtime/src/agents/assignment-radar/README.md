# Assignment radar

Deterministisk agent som samler konsulentoppdrag, kobler kildeobservasjoner til ett oppdrag, scorer mot Carl/FYRK og varsler Slack én gang. Ingen UI eller LLM-kall. Agenten følger `AgentDefinition`, Zod-input, registeret og `POST /run/:agentName`.

## Oppsett

1. Installer runtime-avhengighetene med `cd runtime && pnpm install`.
2. Anvend `supabase/migrations/20260930003838_assignment_radar.sql` i prosjektets eksisterende migrasjonsflyt / Supabase SQL Editor. Migrasjonen er testet i lokal PostgreSQL (PGlite); den blir ikke automatisk anvendt ved serverstart.
3. Behold eksisterende `SUPABASE_URL` og `SUPABASE_SERVICE_KEY`. Tabeller og RPC-er er kun tilgjengelige for `service_role`, med RLS og ingen anon/authenticated-tilgang.
4. Sett `ASSIGNMENT_RADAR_THRESHOLD=70`, `ASSIGNMENT_RADAR_SLACK_BOT_TOKEN` og `ASSIGNMENT_RADAR_SLACK_CHANNEL`. Botten trenger `chat:write` og medlemskap i kanalen. Ingen meldinger sendes før `publish:true` brukes.
Agenten bruker åtte kilder: IC, Omega 365, Kons, Forte Hub, emagine, Right People Group, Sperton og 7N. Ingen kilde krever innlogging. Folq er satt på pause og verken hentes eller kan velges i API-input. Ingen Folq-credentials kreves.

Et faktisk API-kall:

```sh
curl -X POST http://localhost:8787/run/assignment-radar \
  -H 'Content-Type: application/json' \
  -d '{"input":{"threshold":70,"profile":{"maxExtent":100,"preferredLocations":["Oslo","Lysaker","Fornebu"]}},"dryRun":false,"publish":true}'
```

`input.sources` kan begrenses til en eller flere av `ic`, `omega365`, `kons`, `fortehub`, `emagine`, `rightpeoplegroup`, `sperton`, `7n`. Uten input brukes alle åtte kildene, terskel fra miljøet og Oslo-regionen. De fire nye kildene avgrenses til norske oppdrag; irrelevante roller og utløpte oppdrag lagres fortsatt for allerede-sett-logikken. Oppstart lagres, brukes til deduplisering og vises i Slack som oppdragsinformasjon. Carls tilgjengelighet inngår ikke i score, gap eller anbefalt handling. Eldre `profile.availableFrom`-input ignoreres.

`dryRun:true` leser observerte oppdrag fra Supabase, henter kildene og beregner resultat uten DB-skriving eller Slack. Migrasjonen må derfor være anvendt også før en dry run. `publish:false` lagrer funn og kølegger nye relevante oppdrag; en senere kjøring med `publish:true` sender dem. Første kjøring behandler alle hittil ukjente treff som nye, inkludert eksisterende publiseringer. En kjøring med `publish:false` er **ikke** en funksjon for å undertrykke første import.

Agenten oppretter rapportartefakt og logger `found`, `new`, `duplicates`, `filtered`, `posted`, kildefeil og varslingsfeil via runtime. Tallene gjelder observasjoner: duplikater inkluderer tidligere sett identitet og nye portaler som kobles til eksisterende oppdrag; `filtered` kan overlappe med `duplicates`. `posted` gjelder unike oppdrag. Delvis kildefeil gir fortsatt resultater og fremgår av rapporten. Alle kildefeil gir en eksplisitt melding i `errors`.

## Kilder og datamodell

| Adapter | Verifisert henteformat | Tilgang |
| --- | --- | --- |
| IC | `/oppdrag` og Next RSC på detaljsider | Offentlig |
| Omega 365 | `/jobs`, `/jobs/jobinfo/:id`; norske, engelske og internasjonale maler | Offentlig |
| Kons | `/assignments`, `/assignment/:id`; HTML og definisjonsliste | Offentlig |
| Forte Hub | `backend.fortehub.no/api/assignments`; JSON med kunde, periode og krav | Offentlig |
| emagine | Offentlig `JobAds/Search` med Norge-filter og `JobAds/details/:id/NO`; paginert JSON | Offentlig |
| Right People Group | `/nb/open-assignments`; komplett prosjektliste og beskrivelser i Next SSR-data, Norge-filter | Offentlig |
| Sperton | Teamtailor `/jobs?department=Consultant%20jobs&country=Norway`, `show_more` og detaljenes `JobPosting` | Offentlig |
| 7N | `jobs.7n.com/umbraco/api/Search` og `content/getjoboffercontent`; dynamisk Norge-filter og paginering | Offentlig |

De opprinnelige kildene ble undersøkt 30. september 2026, og de fire tilleggene 1. oktober 2026. Adapterne testes mot rene opptak av offentlige svar og avledede variasjoner for kanttilfeller. Zod avviser ukjent format i stedet for å rapportere null treff. Hentingen bruker ikke portalnøkler fra klientkode eller en innlogget nettlesersesjon.

Sperton bruker konsulentavdelingen som utvalg: noen reelle oppdrag er merket `FULL_TIME` i JobPosting. Generelle «Frilansere/Konsulenter»-registreringsannonser fjernes. Hos 7N fjernes stående nettverksannonser som «experiencing high demand», slik at ingen konkrete oppdrag er et gyldig resultat selv når nettsiden annonserer et generelt konsulentbehov. emagine-annonser med lukket status eller «Dekket Stilling» i tittelen fjernes. Manglende sluttkunde blir null; formidlerens navn brukes ikke som kunde. Engelske og norske datoer normaliseres; en frist uten år, som `6.10`, beholdes og må avklares fra originalannonsen.

Følgende kanaler er foreløpig utelatt etter gjennomgang av offentlige sider:

| Kanal | Begrunnelse |
| --- | --- |
| [Brainville](https://www.brainville.com/konsultuppdrag?lang=en) | Full oppdragsbeskrivelse krever konto. |
| [Experis Partner](https://www.experis.no/nb/partner) / [Jefferson Wells Partner](https://www.jeffersonwells.no/nb/partner/selvstendig-konsulent) | Partnerportaler; ingen komplett, enkel offentlig oppdragsfeed verifisert. |
| [FindIT](https://www.finditconsultants.com/no) | Leverandørportalen krever innlogging. |
| [Teaks](https://teakskonsulent.no/for-kandidater) | Registrering og kandidatkontakt, ingen åpen oppdragsliste på nettstedet. |
| [Capax](https://capaxrecruitment.com/no/frilansere/) | Offentlig rekrutteringsliste finnes, men ingen tydelig offentlig feed for konsulentoppdrag ble verifisert. |
| [IT-oppdrag.no](https://it-oppdrag.no) | Nettstedet svarte med utløpt/ikke tilgjengelig side under undersøkelsen. |
| Ework | Utelatt etter brukerens preferanse. |

Disse kan revurderes når en egnet offentlig feed blir tilgjengelig. Folq forblir på pause etter brukerens ønske.

Folq-adapteren er beholdt som uregistrert kode for eventuell senere aktivering. Feltmodellen er kontrollert mot portalens offentlige klientkode, men autentisert listehenting er ikke verifisert. Før aktivering må endepunkt, liste-envelope og eventuell paginering kontrolleres med en gyldig sesjon. Legg deretter til konfigurasjon, registrer adapteren og legg `folq` til `activeSources`. Lagrede Folq-observasjoner er fortsatt lesbare.

Hver observasjon normaliseres til `source`, `external_id`, `url`, `title`, `customer`, `location`, `deadline`, `start_date`, `extent`, `description`, `first_seen_at`, `last_seen_at`. Manglende verdier blir null; ukjente datoer som «Snarest» beholdes som tekst. Generiske kundebeskrivelser som «Privat sektor» blir null. URL-normalisering fjerner fragment og kjente sporingsparametre, men bevarer identifiserende query-parametre.

- `assignment_radar_assignments`: kanonisk oppdrag, score med begrunnelse/gap og tidsstempler.
- `assignment_radar_observations`: portalens egne felt med unik `(source, external_id)` og FK til kanonisk oppdrag. Første observasjonstid bevares; senere observasjoner oppdaterer siste tid og innhold.
- `assignment_radar_deliveries`: én Slack-sendestatus per oppdrag.
- `assignment_radar_lease`: en atomisk, fornybar 15-minutters lås som hindrer samtidige radar-kjøringer. Tap av låsen stopper DB-skriving og varsling.

Også irrelevante og utløpte oppdrag lagres. En ny portal blir en ny observasjon på samme oppdrag, ikke et nytt varsel. Ny kilde gir utfylling av manglende metadata og bevaring av den lengste beskrivelsen; rå observasjoner bevares alltid. Agenten leser kandidater i sider på 500 rader for å unngå Supabase-standardgrensen på 1000.

## Deduplisering

Rekkefølgen er eksakt kilde/ID, kanonisk URL, kunde/rolle/oppstartsperiode og tekstlikhet. Eksakte steg prioriteres globalt før fuzzy steg. Kunden normaliseres for tegnsetting og AS/ASA/SF. Produkt-, test-, leveranse- og rådgiverroller grupperes på tvers av norske/engelske betegnelser.

Kunde/rolle/periode må også støttes av beskrivelseslikhet, særegne tittelord eller felles prosjektakronym/referanse. Generiske titler som «Produktleder» alene slår ikke sammen to team hos samme kunde. Oppstarter mer enn 21 dager fra hverandre eller forskjellige kjente måneder avviser fuzzy match. En oppstart angitt bare med måned sammenlignes med samme måned, uten å finne på en dag.

Portalene kan navngi innkjøpsorganisasjon og sluttkunde forskjellig. Match på sluttkunde i den andre portalens tittel tillates bare med rolle, periode og prosjektkjennetegn/tekst som støtte. Regresjonstesten kobler faktisk FDVU-oppdrag hos Forsvarsbygg fra IC, Kons, Omega og Forte, selv med ulike titler, kundelabels og oppstartsdager. Fuzzy matching er konservativ og kan fortsatt kreve manuell oppfølging ved svært ulike beskrivelser eller manglende datoer.

## Relevansscore

| Faktor | Vektpoeng |
| --- | ---: |
| Rolle | 30 |
| Domene | 15 |
| Senioritet | 10 |
| Lokasjon/remote | 10 |
| Omfang | 5 |
| Obligatoriske krav | 10 |
| Ønskede krav | 5 |
| Dokumentert profil-/erfaringsmatch | 5 |

De åtte faktorene summeres til maksimalt 90 vektpoeng og normaliseres til 0–100 (`round(sum * 100 / 90)`). Dermed beholdes forholdet mellom vektene og eksisterende terskelskala etter at tilgjengelighet er fjernet.

Scoringen bruker `experience-profile.ts`, et strukturert utdrag av Carls innsendte erfaringsbase fra 1. oktober 2026. Denne filen inneholder dokumenterte kvalifikasjoner, konkrete prosjekter, avgrensninger og kundepreferanser. CV-agentens eldre erfaringsfil blir ikke overskrevet. Ved oppdatering av erfaringsbasen må fakta, matcherregler og tester i radaren oppdateres sammen.

Produkt-, test-, team- og prosjektledelse, betaling/PCI, retail, offentlig sektor, dataområdets teamledelse, anvendt AI, internasjonale team, verktøy, utdanning og sertifiseringer inngår. Matchvurderingen navngir opptil to konkrete erfaringer, for eksempel Varner eller Domstoladministrasjonen, i stedet for en generell domeneliste. Ingen LLM brukes til å lese eller vurdere profilen.

Avgrensningene i den nye basen er eksplisitte: 23 måneder med formell produktledertittel; funksjonelt ansvar i Kundedialog har ukjent start og Varner-vikariatet telles ikke i årskrav. Høyere obligatoriske produktleder-årskrav krever avklaring. Teamledelse i dataområdet fra feb–des 2023 gir ikke teknisk ekspertise i Databricks/Snowflake. Norsk/engelsk er profesjonelt nivå, svensk er morsmål, tysk er grunnleggende. FYRKs egen agentplattform er ikke et eksternt kundeoppdrag. SpareBank 1 filtreres når det er oppgitt som kunde; omtale av tidligere erfaring der filtrerer ikke et annet oppdrag.

Ikke dokumenterte obligatoriske krav gir maksimalt 55 poeng. Utløpt frist eller en eksplisitt utelatt kunde gir 0 og ingen varsling. Urelaterte roller varsles ikke, selv ved lav terskel. Ukjent omfang og arbeidssted gir delpoeng og eksplisitte gap. Vurderingen er fortsatt en deterministisk prioriteringsscore med begrenset tekstforståelse; ukjente formuleringer og sammensatte krav kan kreve manuell vurdering. Originalteksten skal kontrolleres før søknad.

## Slack og feilhåndtering

Slack-posten inneholder rolle, kunde, alle observerte portaler, oppstart, omfang, frist, matchvurdering, viktigste gap, anbefalt handling og lenker til observasjonene. En post reserveres atomisk i databasen **før** `chat.postMessage`. Kanonisk UUID sendes som `client_msg_id`.

- `pending`: kan sendes ved neste publiserende kjøring dersom score fortsatt passer terskelen og fristen ikke er utløpt.
- `sending`: reservert; et prosesskrasj kan etterlate denne statusen.
- `sent`: Slack har bekreftet kanal og `ts`; sendes aldri igjen.
- `uncertain`: nettverksfeil eller tvetydig respons; sendes aldri automatisk igjen.

Slack `ok:false` er en bekreftet avvisning og blir `pending` igjen. Rapporten og leveransestatusen inkluderer en avgrenset Slack-feilkode, for eksempel `channel_not_found` eller `not_in_channel`, slik at kanal og bottilgang kan rettes. Vilkårlig responsinnhold logges ikke. Ved `sending`/`uncertain` må Slack undersøkes manuelt før status eventuelt settes til `pending` eller `sent`. Dette prioriterer å unngå duplikatposter; tvetydige feil kan føre til et manglende varsel. Endringer i oppdrag eller nye portaler oppdaterer databasen, ikke allerede sendt Slack-post. Tidligere filtrerte oppdrag varsles ikke retroaktivt bare fordi terskelen senkes.

Én kilde eller detaljside kan feile uten å stoppe andre. Hentinger har 20 sekunders timeout og detaljsider hentes fire om gangen per portal. Innloggingssider eller ukjent format rapporteres som feil. Ingen skjult LLM-tolkning eller automatisk innlogging brukes.

## Legge til en ny portal (inkludert en sjette)

1. Legg portal-ID til `sources` og `activeSources` i `schemas.ts`. `sources` beskriver lagrede observasjoner; `activeSources` styrer hvilke kilder API-et kan kjøre.
2. Opprett `sources/<portal>.ts` med `SourceAdapter`, et eksportert deterministisk `parse<Portal>` og faste, verifiserte liste-/detalj- eller API-endepunkter. Bruk `getText`, `links`, `fetchDetails` og `normalize` der de passer. Implementer eventuell paginering eksplisitt; ikke anta at første side er komplett.
3. Undersøk portalens faktiske format. Ved innlogging: legg et valgfritt, portalspesifikt felt til `lib/env.ts` og `.env.example`. Send credentials bare til denne portalens verifiserte host. Feil tilgang skal rapporteres tydelig.
4. Registrer adapteren i `sources/index.ts`; registeret og `/run/assignment-radar` trenger ingen endring. Supabase trenger ingen ny tabell: `source` er tekst, og den nye portalen bruker samme observasjonsskjema.
5. Lag anonymiserte/rene fixtures i `test/fixtures/assignment-radar`. Test listehenting, normalisering av alle metadata, tom liste, formatendring, HTTP-feil og eventuell paginering.
6. Legg til et reelt eksempel på samme oppdrag fra en annen portal og en negativ test med en annen kunde/rolle/periode. Unngå å senke globale likhetsterskler for å få ett eksempel til å passe.
7. Kjør testene og en kildebegrenset dry run mot Supabase før publisering.

## Tester

```sh
cd runtime
pnpm test
pnpm typecheck
pnpm build
pnpm exec eslint src/agents/assignment-radar src/agents/base.ts src/agents/registry.ts src/lib/env.ts src/routes/run.ts --ext .ts
```

`assignment-radar.test.ts` dekker opprinnelige adaptere, normalisering, score, deduplisering, allerede sett, kildefeil, dry run, publish, Slack-feil og eksisterende API. `assignment-radar-experience.test.ts` dekker erfaringsgrunnlag, årskrav, sertifiseringer, språk, dataområdets avgrensninger, konkrete Slack-begrunnelser og kundepreferanse. `assignment-radar-public-sources.test.ts` dekker de fire tilleggene, Norge-avgrensning, metadata, paginering, format-/HTTP-feil, filtrering av registreringsannonser og kobling til allerede observerte oppdrag. `assignment-radar-db.test.ts` kjører migrasjonen i PGlite og tester transaksjoner, unik kildeidentitet, bevart first_seen, låsing, atomisk varslingsreservasjon og Supabase-roller/RLS. Database- og Slack-tester krever ikke produksjonscredentials.
