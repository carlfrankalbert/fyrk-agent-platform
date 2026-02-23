-- FYRK Mat Agent - Seed food traditions
-- Norwegian and Swedish food traditions

insert into food_traditions (name, country, months, typical_dishes, suggest_strength, description) values
  ('Tacofredag', 'NO', '{1,2,3,4,5,6,7,8,9,10,11,12}', '{"taco", "guacamole", "salsa", "tortilla"}', 'hint', 'Fredagstaco er Norges mest populaere fredagstradisjon. Kan varieres med fisk, boenne- eller kyllingtaco.'),
  ('Sondagsmiddag', 'NO', '{1,2,3,4,5,6,7,8,9,10,11,12}', '{"stek", "kylling", "lammestek", "ribbe"}', 'hint', 'Tradisjonell sondagsmiddag med kjott, poteter og gronnsaker. God tid til a lage mat sammen.'),
  ('Matpakke', 'NO', '{1,2,3,4,5,6,7,8,9,10,11,12}', '{"brodskiver", "knekkebroed", "paalegg", "frukt"}', 'hint', 'Norsk matpakke-tradisjon. Broed med paalegg til lunsj, barnehage og skole.'),
  ('Farikal', 'NO', '{9,10}', '{"farikal", "kokt lam", "kal"}', 'strong', 'Farikal er Norges nasjonalrett. Farikal-sesong er i september-oktober. Enkel og naeringsrik.'),
  ('Lutefisk', 'NO', '{11,12}', '{"lutefisk", "ertesuppe", "lefse"}', 'suggest', 'Tradisjonell julemat. Lutefisksesong starter i november.'),
  ('Pinnekjott', 'NO', '{12}', '{"pinnekjott", "kalrotstappe", "poteter"}', 'strong', 'Vestlandets julemat. Saltet og torket lammeribbe. Servert med kalrotstappe.'),
  ('Ribbe', 'NO', '{12}', '{"ribbe", "surkal", "medisterkaker", "poteter"}', 'strong', 'Ostlandets julemat. Sproesteekt svineribbe med tilbehoer.'),
  ('Julegrout', 'NO', '{12}', '{"risgrout", "riskrem", "multekrem"}', 'suggest', 'Risgrout pa julaften-formiddag er en tradisjon i mange norske hjem.'),
  ('Paaske', 'NO', '{3,4}', '{"lam", "appelsin", "Kvikk Lunsj", "egg"}', 'suggest', 'Paaskeferie med lammekjott og appelsin. Fjelltur og skigaing.'),
  ('17. mai', 'NO', '{5}', '{"polser", "is", "kaker", "jordbarpai"}', 'strong', 'Nasjonaldagen feires med polser, is og kaker. Barnetog og fest.'),
  ('Skreisesong', 'NO', '{1,2,3}', '{"skrei", "torsk", "torsketunger", "lever"}', 'suggest', 'Skrei (vinterfisket torsk) er tilgjengelig januar-mars. Premium kvalitet.'),
  ('Rakfisk', 'NO', '{11}', '{"rakfisk", "lefse", "rodloek", "roemmegrout"}', 'suggest', 'Rakfisksesong i november. Tradisjonsmat fra Valdres og fjellbygdene.'),
  ('Midsommar', 'SE', '{6}', '{"sill", "jordgubbar", "noypotatis", "graddfil"}', 'strong', 'Svensk midsommar med sill, nypoteter og jordbaer. Feires rundt 21. juni.'),
  ('Kraftskiva', 'SE', '{8}', '{"kraftor", "snaps", "brod", "ost"}', 'suggest', 'Svensk krepsefest i august. Krebs, snaps og sang.'),
  ('Kanelbullens dag', 'SE', '{10}', '{"kanelboller", "kardemommeboller"}', 'hint', '4. oktober er kanelbollens dag i Sverige. Bak kanelboller!'),
  ('Samisk matkultur', 'NO', '{1,2,3,9,10,11,12}', '{"bidos", "reinsdyrkjott", "gahkku"}', 'hint', 'Samisk matkultur med rein, bidos (reinsdyrsuppe) og gahkku (flatbroed).'),
  ('Vaffeldag', 'NO/SE', '{3}', '{"vafler", "syltetoy", "roemmegrout"}', 'hint', '25. mars er vaffeldagen. Norske hjerteformede vafler med syltetoy og roemmegrout.'),
  ('Sankthansmiddag', 'NO', '{6}', '{"grillet", "jordbarpai", "reker", "salat"}', 'suggest', 'Sankthansaften 23. juni. Grilling, reker og jordbaer.'),
  ('Hostsuppe', 'NO', '{9,10,11}', '{"gulasjsuppe", "gresskarsuppe", "loekksuppe"}', 'hint', 'Hostsesongen innbyr til varme supper med sesongvarer. Perfekt for travrle hverdager.'),
  ('Grateng-sesong', 'NO', '{1,2,11,12}', '{"fiskegrateng", "blomkalgrateng", "lasagne"}', 'hint', 'Vintersesongen er perfekt for gratengar. Varmende og barnevennlig.')
on conflict (name) do nothing;
