/**
 * Lector de CSV mínimo para el importador de cruces (B1). Sin dependencias:
 * soporta comillas dobles (con comillas escapadas "" y saltos de línea
 * adentro), BOM de Excel y separador `;` o `,` detectado en la cabecera (Excel
 * en español exporta con `;`).
 */

export interface TablaCsv {
  columnas: string[];
  filas: string[][];
}

function detectarSeparador(texto: string): ';' | ',' {
  const primeraLinea = texto.slice(0, texto.search(/\r?\n|$/));
  const contar = (sep: string) => primeraLinea.split(sep).length - 1;
  return contar(';') > contar(',') ? ';' : ',';
}

export function leerCsv(texto: string): TablaCsv {
  const limpio = texto.replace(/^﻿/, '');
  const separador = detectarSeparador(limpio);
  const registros: string[][] = [];
  let registro: string[] = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      registro.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      registro.push(campo);
      registros.push(registro);
      registro = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || registro.length > 0) {
    registro.push(campo);
    registros.push(registro);
  }

  // Filas totalmente vacías (líneas en blanco al final, típico de Excel) no cuentan.
  const noVacias = registros.filter((r) => r.some((valor) => valor.trim() !== ''));
  const [cabecera = [], ...filas] = noVacias;
  return { columnas: cabecera.map((c) => c.trim()), filas };
}
