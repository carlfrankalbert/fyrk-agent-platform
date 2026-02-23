-- FYRK Timing Radar - Seed target accounts
-- Nordic companies FYRK wants to work with
-- Adjust and add your actual targets here

insert into target_accounts (name, domain, industry, segment, tier, notes) values
  ('Vipps', 'vipps.no', 'Fintech', 'enterprise', 'A', 'Norges ledende betalingsapp'),
  ('Oda', 'oda.com', 'E-commerce / Dagligvare', 'scaleup', 'A', 'Online dagligvarehandel'),
  ('Klarna', 'klarna.com', 'Fintech', 'enterprise', 'A', 'BNPL-gigant, stor nordisk tilstedevarelse'),
  ('Finn.no', 'finn.no', 'Markedsplass', 'enterprise', 'A', 'Norges storste markedsplass'),
  ('Schibsted', 'schibsted.com', 'Media / Tech', 'enterprise', 'A', 'Mediekonsern med mange digitale produkter'),
  ('Kahoot!', 'kahoot.com', 'EdTech', 'enterprise', 'A', 'Norsk edtech-suksess'),
  ('Autostore', 'autostoresystem.com', 'Robotikk / Logistikk', 'enterprise', 'B', 'Lagerautomatisering'),
  ('Cognite', 'cognite.com', 'IndustriTech', 'scaleup', 'B', 'Industriell dataplattform'),
  ('Pexip', 'pexip.com', 'Videokonferanse', 'enterprise', 'B', 'Enterprise videoplattform'),
  ('Tibber', 'tibber.com', 'EnergiTech', 'scaleup', 'B', 'Smart stromselskap'),
  ('Kolonial / Oda', 'oda.com', 'E-commerce', 'scaleup', 'B', null),
  ('Remarkable', 'remarkable.com', 'Hardware / Tech', 'scaleup', 'B', 'Digital papirtablet'),
  ('Posten / Bring', 'bring.com', 'Logistikk', 'enterprise', 'B', 'Norges postselskap'),
  ('DNB', 'dnb.no', 'Bank / Finans', 'enterprise', 'B', 'Norges storste bank'),
  ('Telenor', 'telenor.com', 'Telekom', 'enterprise', 'B', 'Nordisk telekonsern'),
  ('Wolt', 'wolt.com', 'Leveringstjeneste', 'enterprise', 'B', 'Mat- og vareleveranse'),
  ('Telia', 'telia.no', 'Telekom', 'enterprise', 'C', 'Nordisk teleoperator'),
  ('Elkjop', 'elkjop.no', 'Retail / Elektronikk', 'enterprise', 'C', 'Nordens storste elektronikkjede'),
  ('Visma', 'visma.com', 'Enterprise Software', 'enterprise', 'B', 'Nordisk programvarekonsern'),
  ('Sparebank 1', 'sparebank1.no', 'Bank / Finans', 'enterprise', 'C', 'Bankallianser i Norge')
on conflict (domain) do nothing;
