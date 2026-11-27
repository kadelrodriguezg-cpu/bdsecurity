-- Región administrativa de cada predio. Se usa enum, igual que tipo_ronda:
-- es un catálogo estable y cerrado, por lo que la base impide variantes de
-- escritura y valores fuera de las 16 regiones oficiales de Chile.
create type region_chile as enum (
  'Arica y Parinacota',
  'Tarapacá',
  'Antofagasta',
  'Atacama',
  'Coquimbo',
  'Valparaíso',
  'Metropolitana de Santiago',
  'Libertador General Bernardo O''Higgins',
  'Maule',
  'Ñuble',
  'Biobío',
  'La Araucanía',
  'Los Ríos',
  'Los Lagos',
  'Aysén del General Carlos Ibáñez del Campo',
  'Magallanes y de la Antártica Chilena'
);

alter table predio add column region region_chile;

comment on column predio.region is
  'Región oficial de Chile, opcional. Catálogo cerrado para impedir variantes de texto libre.';
