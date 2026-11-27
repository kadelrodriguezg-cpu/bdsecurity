-- =============================================================================
-- MIGRACIÓN 20260811000200 — EVECL: semilla del catálogo UPOV (Sprint E1, commit 3/3)
--
-- Siembra los 27 descriptores del Anexo A (sección 9.9 del Documento Maestro):
-- 20 de tipo 'estado' + 7 de tipo 'valor'. Las notas UPOV se transcriben
-- LITERALES — no son una escala 1-5 uniforme, cada descriptor trae su propio
-- conjunto (3/5/7, 1/2/3, 1/3/5/7/9, 1/2 según el caso). No se normalizan ni
-- se completan huecos.
--
-- HALLAZGO A REVISAR CON EL DUEÑO ANTES DE E2 (no bloquea este commit): la
-- tabla de 9.4.3 lista 8 filas con dirección de ranking, pero una de ellas
-- ("Relación °Brix/Acidez") es, según el propio texto de 9.9, "un criterio
-- derivado que no es un descriptor capturable: se calcula cuando existen los
-- valores 29 y 30" — o sea, NO tiene fila propia en evecl_descriptor, se
-- calcula en la RPC de scoring (E2) a partir de Dulzor y Acidez. Sembrar un
-- descriptor fantasma solo para forzar el conteo sería fabricar un dato falso
-- para pasar una verificación, así que NO se hace. Esto deja
-- `count(*) where rankeable` en 7, no en 8 como decía el prompt E1 al pie de
-- la letra. Se documenta acá en vez de resolverlo en silencio.
-- =============================================================================

insert into evecl_descriptor (codigo_upov, nombre, tipo, eje, unidad, nota_especial, rankeable, direccion_ranking, orden) values
  -- ---- tipo 'estado' (20), orden = orden del Anexo A ----
  (1,  'Vigor',                                                          'estado', 'adaptabilidad', null, null,
   false, null, 1),
  (2,  'Hábito de crecimiento',                                          'estado', 'adaptabilidad', null, null,
   false, null, 2),
  (5,  'Largo de la hoja',                                               'estado', 'adaptabilidad', null, null,
   false, null, 3),
  (8,  'Forma de la hoja',                                               'estado', 'adaptabilidad', null, null,
   false, null, 4),
  (10, 'Hoja: intensidad del color verde del haz',                       'estado', 'adaptabilidad', null, 'Solo variedades con hoja verde',
   false, null, 5),
  (11, 'Márgenes de la hoja',                                            'estado', 'adaptabilidad', null, null,
   false, null, 6),
  (15, 'Tamaño de la corola',                                            'estado', 'calidad',       null, null,
   false, null, 7),
  (16, 'Pigmentación antociánica del tubo de la corola',                 'estado', 'calidad',       null, null,
   false, null, 8),
  (18, 'Densidad de la infrutescencia',                                  'estado', 'productividad', null, 'Eje morfológico UPOV es calidad, pero rankea en productividad por ser un descriptor de fruto que informa carga productiva (ver 9.4.3)',
   true,  'mayor', 9),
  (19, 'Fruto no maduro: intensidad del color verde',                    'estado', 'calidad',       null, null,
   false, null, 10),
  (20, 'Tamaño del fruto',                                               'estado', 'calidad',       null, null,
   true,  'mayor', 11),
  (21, 'Forma sección longitudinal del fruto',                           'estado', 'calidad',       null, null,
   false, null, 12),
  (26, 'Intensidad de la pruina (bloom)',                                'estado', 'calidad',       null, null,
   false, null, 13),
  (27, 'Color de la epidermis tras quitar la pruina',                    'estado', 'calidad',       null, null,
   false, null, 14),
  (31, 'Tipo de fructificación',                                        'estado', 'fenologia',     null, null,
   false, null, 15),
  (32, 'Época de aparición yema de madera',                              'estado', 'fenologia',     null, null,
   false, null, 16),
  (33, 'Época de inicio de floración (rama de un año)',                  'estado', 'fenologia',     null, null,
   false, null, 17),
  (34, 'Época de inicio de floración (rama del corriente año)',          'estado', 'fenologia',     null, 'Solo variedades que fructifican en ramas de 1 año y de estación',
   false, null, 18),
  (35, 'Época de inicio de madurez del fruto (rama de un año)',          'estado', 'fenologia',     null, null,
   false, null, 19),
  (36, 'Época de inicio de madurez del fruto (rama del corriente año)',  'estado', 'fenologia',     null, 'Solo variedades que fructifican en ramas de 1 año y de estación (misma condición que UPOV 34)',
   false, null, 20),

  -- ---- tipo 'valor' (7) ----
  (28, 'Firmeza',                              'valor', 'calidad',       null,             null,
   true,  'mayor', 21),
  (29, 'Dulzor (sólidos solubles)',            'valor', 'calidad',       '°Brix',          null,
   true,  'mayor', 22),
  (30, 'Acidez',                               'valor', 'calidad',       '% ác. cítrico',  'Excluida del ranking de Calidad en aislado; alimenta el cálculo de la Relación °Brix/Acidez (criterio derivado, ver 9.4.3 y 9.9)',
   false, null, 23),
  (null, 'Tamaño de la cicatriz peduncular',   'valor', 'calidad',       'mm',             null,
   true,  'menor', 24),
  (null, 'Rendimiento',                        'valor', 'productividad', 'g/planta',       null,
   true,  'mayor', 25),
  (null, '% de frutos por calibre',            'valor', 'productividad', 'texto libre',    'Excluido del ranking: es un valor de texto libre (se captura en evecl_respuesta.valor_texto, no valor_numerico)',
   false, null, 26),
  (null, 'Días de postcosecha (frío 0°C)',     'valor', 'productividad', 'días',           null,
   true,  'mayor', 27);


-- =============================================================================
-- Estados nominales por descriptor (evecl_descriptor_estado), unidos por
-- codigo_upov ya que es único entre los descriptores de tipo 'estado'.
-- =============================================================================

-- UPOV 1 — Vigor: 3 Débil, 5 Medio, 7 Fuerte
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Débil',1),(5,'Medio',2),(7,'Fuerte',3)) as v(nota,label,orden)
where codigo_upov = 1;

-- UPOV 2 — Hábito de crecimiento: 1 Erecto, 2 Semierecto, 3 Rastrero
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Erecto',1),(2,'Semierecto',2),(3,'Rastrero',3)) as v(nota,label,orden)
where codigo_upov = 2;

-- UPOV 5 — Largo de la hoja: 3 Corta, 5 Media, 7 Larga
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Corta',1),(5,'Media',2),(7,'Larga',3)) as v(nota,label,orden)
where codigo_upov = 5;

-- UPOV 8 — Forma de la hoja: 1 Lanceolada, 2 Oval, 3 Elíptica, 4 Oblonga
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Lanceolada',1),(2,'Oval',2),(3,'Elíptica',3),(4,'Oblonga',4)) as v(nota,label,orden)
where codigo_upov = 8;

-- UPOV 10 — Hoja: intensidad del color verde del haz: 3 Clara, 5 Media, 7 Oscura
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Clara',1),(5,'Media',2),(7,'Oscura',3)) as v(nota,label,orden)
where codigo_upov = 10;

-- UPOV 11 — Márgenes de la hoja: 1 Entero, 2 Cerrado
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Entero',1),(2,'Cerrado',2)) as v(nota,label,orden)
where codigo_upov = 11;

-- UPOV 15 — Tamaño de la corola: 3 Pequeña, 5 Medio, 7 Grande
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Pequeña',1),(5,'Medio',2),(7,'Grande',3)) as v(nota,label,orden)
where codigo_upov = 15;

-- UPOV 16 — Pigmentación antociánica del tubo de la corola: 3 Débil, 5 Media, 7 Fuerte
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Débil',1),(5,'Media',2),(7,'Fuerte',3)) as v(nota,label,orden)
where codigo_upov = 16;

-- UPOV 18 — Densidad de la infrutescencia: 3 Baja, 5 Media, 7 Alta
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Baja',1),(5,'Media',2),(7,'Alta',3)) as v(nota,label,orden)
where codigo_upov = 18;

-- UPOV 19 — Fruto no maduro: intensidad del color verde: 3 Clara, 5 Media, 7 Oscuro
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Clara',1),(5,'Media',2),(7,'Oscuro',3)) as v(nota,label,orden)
where codigo_upov = 19;

-- UPOV 20 — Tamaño del fruto: 3 Pequeño, 5 Medio, 7 Grande
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Pequeño',1),(5,'Medio',2),(7,'Grande',3)) as v(nota,label,orden)
where codigo_upov = 20;

-- UPOV 21 — Forma sección longitudinal del fruto: 1 Elíptica, 2 Redonda, 3 Oblata
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Elíptica',1),(2,'Redonda',2),(3,'Oblata',3)) as v(nota,label,orden)
where codigo_upov = 21;

-- UPOV 26 — Intensidad de la pruina (bloom): 1 Muy débil, 3 Débil, 5 Media, 7 Fuerte
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Muy débil',1),(3,'Débil',2),(5,'Media',3),(7,'Fuerte',4)) as v(nota,label,orden)
where codigo_upov = 26;

-- UPOV 27 — Color de la epidermis tras quitar la pruina: 1 Azul claro, 2 Azul medio, 3 Azul oscuro, 4 Rojo azulado
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Azul claro',1),(2,'Azul medio',2),(3,'Azul oscuro',3),(4,'Rojo azulado',4)) as v(nota,label,orden)
where codigo_upov = 27;

-- UPOV 31 — Tipo de fructificación: 1 Solo ramas de 1 año, 2 Ramas de 1 año y de estación
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Solo ramas de 1 año',1),(2,'Ramas de 1 año y de estación',2)) as v(nota,label,orden)
where codigo_upov = 31;

-- UPOV 32 — Época de aparición yema de madera: 3 Temprana, 5 Media, 7 Tardía
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Temprana',1),(5,'Media',2),(7,'Tardía',3)) as v(nota,label,orden)
where codigo_upov = 32;

-- UPOV 33 — Época de inicio de floración (rama de un año): 1/3/5/7/9
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Muy temprana',1),(3,'Temprana',2),(5,'Media',3),(7,'Tardía',4),(9,'Muy tardía',5)) as v(nota,label,orden)
where codigo_upov = 33;

-- UPOV 34 — Época de inicio de floración (rama del corriente año): 3 Temprana, 5 Media, 7 Tardía
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Temprana',1),(5,'Media',2),(7,'Tardía',3)) as v(nota,label,orden)
where codigo_upov = 34;

-- UPOV 35 — Época de inicio de madurez del fruto (rama de un año): 1/3/5/7/9
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (1,'Muy temprana',1),(3,'Temprana',2),(5,'Media',3),(7,'Tardía',4),(9,'Muy tardía',5)) as v(nota,label,orden)
where codigo_upov = 35;

-- UPOV 36 — Época de inicio de madurez del fruto (rama del corriente año): 3 Temprana, 5 Media, 7 Tardía
insert into evecl_descriptor_estado (descriptor_id, nota, label, orden)
select id, v.nota, v.label, v.orden
from evecl_descriptor, (values (3,'Temprana',1),(5,'Media',2),(7,'Tardía',3)) as v(nota,label,orden)
where codigo_upov = 36;
