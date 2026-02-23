-- FYRK Mat Agent - Seed nutrition knowledge
-- Based on Helsedirektoratet guidelines and child nutrition research

insert into nutrition_knowledge (category, topic, content, applies_to, source) values
  ('generelt', 'Tallerkenmodellen', 'Fyll halve tallerkenen med gronnsaker, en fjerdedel med protein, en fjerdedel med karbohydrater (fullkorn). Gir balansert naeringsprofil.', 'all', 'Helsedirektoratet 2024'),
  ('generelt', 'Fisk per uke', 'Spis fisk 2-3 ganger per uke, hvorav minst en gang fet fisk (laks, makrell, sild). Gir omega-3, D-vitamin og jod.', 'all', 'Helsedirektoratet 2024'),
  ('generelt', 'Rodt kjott', 'Begrens rodt kjott til maks 500g per uke (tilberedt vekt). Velg magre stykker. Unnga bearbeidet kjott.', 'all', 'Helsedirektoratet 2024'),
  ('generelt', 'Plantevariasjoner', 'Spis minst 500g gronnsaker og frukt daglig. Streb etter 30 ulike plantesorter per uke for tarmhelse.', 'all', 'British Journal of Nutrition 2023'),
  ('generelt', 'Fullkorn', 'Velg grove kornprodukter: grovt brod, havregryn, fullkornspasta, natris. Gir fiber, B-vitaminer og mineraler.', 'all', 'Helsedirektoratet 2024'),
  ('generelt', 'Fiber', 'Voksne trenger 25-35g fiber daglig. Barn 2-5 ar: ca 15g. Oek gradvis for a unnga mageproblemer.', 'all', 'Helsedirektoratet 2024'),
  ('generelt', 'Fermentert mat', 'Fermentert mat (yoghurt, kefir, surkal, kimchi, miso) stotter tarmflora. Inkluder en porsjon daglig.', 'all', 'World Gastroenterology Organisation'),
  ('generelt', 'Ultrabearbeidet', 'Begrens ultrabearbeidet mat (ferdigretter, snacks, brus). Koble med ekte rastoffer sa mye som mulig.', 'all', 'NOVA-klassifisering / Helsedirektoratet'),
  ('generelt', 'Proteinfordeling', 'Fordel proteininntak jevnt over dagens maltider (20-30g per maltid) for optimal muskeloppbygging.', 'adults', 'Nordiske naeringsanbefalinger 2023'),
  ('generelt', 'Belgfrukter', 'Spis belgfrukter (linser, boenner, kikerter) minst 2-3 ganger per uke. Rik pa fiber, protein og mineraler.', 'all', 'Helsedirektoratet 2024'),
  ('barn', 'Jern', 'Barn 1-5 ar trenger 8mg jern daglig. Gode kilder: kjott, boenner, linser, havregryn. Kombiner med C-vitamin for bedre opptak.', 'children_1_5', 'Helsedirektoratet 2024'),
  ('barn', 'Kalsium', 'Barn 1-5 ar trenger 600mg kalsium daglig. Gode kilder: melk, yoghurt, ost, brokkoli, mandler, beriket plantemelk.', 'children_1_5', 'Helsedirektoratet 2024'),
  ('barn', 'D-vitamin', 'Alle barn bor ta D-vitamintilskudd. Kostkilder: fet fisk, egg, beriket melk. Viktig for bein og immunforsvar.', 'children_1_5', 'Helsedirektoratet 2024'),
  ('barn', 'Omega-3', 'Barn trenger omega-3 for hjerneutvikling. Gode kilder: fet fisk (laks, makrell), valnotter, chiafroi, rapsolje.', 'children_1_5', 'Helsedirektoratet 2024'),
  ('barn', 'Picky eaters', 'Tilby mat gjentatte ganger (8-15 forsok). Ikke press. La barn delta i matlaging. Server nye matvarer sammen med kjente.', 'children_1_5', 'BLW-forskning / Helsestasjon'),
  ('barn', 'Sukkerbegrensning', 'Barn under 2 ar: unnga tilsatt sukker. Barn 2-5 ar: maks 25g tilsatt sukker daglig (ca 6 terninger).', 'children_1_5', 'WHO / Helsedirektoratet'),
  ('barn', 'Jernopptak', 'Tanniner (te, kaffe) hemmer jernopptak. Gi C-vitaminrik mat (paprika, appelsinjuice) sammen med jernrike maltider.', 'children_1_5', 'Helsedirektoratet 2024'),
  ('kosttilskudd', 'Tran', 'Alle i Norge bor ta tran eller D-vitamintilskudd fra oktober til mars pga lite sollys.', 'all', 'Helsedirektoratet 2024'),
  ('kosttilskudd', 'Folsyre', 'Kvinner som planlegger graviditet bor ta 400 mikrogram folsyre daglig fra planlegging til uke 12.', 'adults', 'Helsedirektoratet 2024'),
  ('tips', 'Tarmhelse', 'Rik tarmflora stotter immunforsvar, mental helse og naeringsopptak. Variert kost med fiber og fermentert mat er nokkelen.', 'all', 'Lancet Gastroenterology 2023'),
  ('tips', 'Batch cooking', 'Lag doble porsjoner 1-2 ganger i uken. Frys porsjoner for travle dager. Sparer tid og reduserer matsvinn.', 'all', 'Praktisk erfaring'),
  ('tips', 'Maltidsplanlegging', 'Planlegg 5-7 middager for uken. Bruk sesongvarer. Ha 1-2 rester-dager. Reduserer stress og matsvinn.', 'all', 'Praktisk erfaring'),
  ('tips', 'Matsvinn', 'Bruk gronnsaker som begynner a bli slappe i suppe, wok eller smoothie. Bruk brodrenner til gratinering eller panzanella.', 'all', 'Matvett.no'),
  ('tips', 'Krydder barn', 'Barn liker mildere smaker. Start med urter (basilikum, persille, dill) for du introduserer sterkere krydder.', 'children_1_5', 'Praktisk erfaring'),
  ('tips', 'Maltidsstund', 'Spis sammen som familie uten skjermer. Barn laerer matkultur og spiser bedre nar de ser voksne spise variert.', 'all', 'Helsedirektoratet 2024')
on conflict do nothing;
