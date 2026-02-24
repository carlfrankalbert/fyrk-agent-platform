# Husmor — Utsatte features

Features som er identifisert men utsatt til senere faser.

## Handleliste-integrasjon med beholdning

I dag er handleliste og beholdning frakoblet. Husmor kunne automatisk trekke fra varer som allerede er pa lager nar den genererer handleliste — og markere inventory notes som "brukt" etter at en uke er gjennomfort.

## Rester-logikk

Husmor vet ikke at onsdag-middagen produserer rester som kan bli torsdag-lunsj. En enkel `yields_leftovers`-flag pa planned_meals + instruksjon i prompten ville gitt bedre planlegging og mindre matsvinn.

## Bedre oppskrifts-gjenbruk

`loadSavedRecipes` henter oppskrifter, men Claude bruker dem ikke aktivt i planlegging. En instruksjon som "foresla lagrede oppskrifter med hoy rating for du genererer nye" ville gjort minnet nyttig.

## Multi-signal laeringskonsolidering

Kryssreferanse laerdommer fra ulike kilder (samtaleekstraksjon, foreslatte laerdommer, maltidsmonstre). Oppdage motstridende signaler og konsolidere til en samlet forstaelse av familiens preferanser.

## Kontekstuell tilpasning

Tilpasse middagskompleksitet basert pa kontekst:
- Travel uke (enklere middager, kortere tilberedningstid)
- Gjester (storre porsjoner, mer imponerende retter)
- Helligdager og hoytider (tradisjonelle retter)
- Ferie (avslappet modus, ingen plan nodvendig)

## Barns smaksutvikling

Sporing av per-barn aksept og avvisning av retter. Gradvis utvide paletten ved a introdusere nye smaker i kjente kombinasjoner. Laeringsmodell for hvert barns smakspreferanser over tid.

## Ernaeringssporing

Estimert naeringsinnhold per uke basert pa planlagte middager og oppskrifter. Gap-analyse mot offisielle kostrad (Helsedirektoratet/Livsmedelsverket). Identifisere mangler (f.eks. for lite fisk, for mye rodt kjott) og foresla justeringer.
