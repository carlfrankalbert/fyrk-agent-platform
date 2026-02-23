-- FYRK Mat Agent - Seed pantry staples
-- Items always in stock (excluded from shopping lists)

insert into pantry_staples (household_id, name, category) values
  ('default', 'Salt', 'krydder'),
  ('default', 'Pepper', 'krydder'),
  ('default', 'Olivenolje', 'basis'),
  ('default', 'Rapsolje', 'basis'),
  ('default', 'Smoer', 'basis'),
  ('default', 'Soyasaus', 'krydder'),
  ('default', 'Hermetiske tomater', 'hermetikk'),
  ('default', 'Tomatpure', 'hermetikk'),
  ('default', 'Ris', 'torrvarer'),
  ('default', 'Pasta', 'torrvarer'),
  ('default', 'Hvetemel', 'torrvarer'),
  ('default', 'Sukker', 'torrvarer'),
  ('default', 'Hvitloek', 'basis'),
  ('default', 'Loek', 'basis'),
  ('default', 'Buljong (kylling)', 'basis'),
  ('default', 'Buljong (gronnsak)', 'basis'),
  ('default', 'Havregryn', 'torrvarer'),
  ('default', 'Kokosmelk', 'hermetikk'),
  ('default', 'Kikerter (hermetiske)', 'hermetikk'),
  ('default', 'Roede linser', 'torrvarer')
on conflict (household_id, name) do nothing;
