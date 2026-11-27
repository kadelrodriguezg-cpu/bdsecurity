/**
 * Tests de interpretarQR — el único punto donde se decide qué destino tiene
 * lo que el escáner leyó. Importa sobre todo confirmar que un UUID PELADO
 * (sin URL alrededor) se interpreta como { tipo: 'id' }: es el formato que
 * codifican las etiquetas PEQUEÑAS (13x40mm), donde no entra la URL completa.
 */
import { describe, expect, it } from 'vitest';
import { interpretarQR } from './QRScanner';

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('interpretarQR', () => {
  it('interpreta un UUID pelado como id (formato de la etiqueta pequeña)', () => {
    expect(interpretarQR(UUID)).toEqual({ tipo: 'id', valor: UUID });
  });

  it('normaliza a minúsculas un UUID pelado en mayúsculas', () => {
    expect(interpretarQR(UUID.toUpperCase())).toEqual({ tipo: 'id', valor: UUID });
  });

  it('interpreta la URL completa de la ficha como id (etiquetas grande/mediana)', () => {
    expect(interpretarQR(`https://app.ejemplo.com/planta/${UUID}`)).toEqual({ tipo: 'id', valor: UUID });
  });

  it('interpreta el path relativo /planta/<uuid> como id', () => {
    expect(interpretarQR(`/planta/${UUID}`)).toEqual({ tipo: 'id', valor: UUID });
  });

  it('interpreta un QR viejo de Notion como codigo_sistema', () => {
    const notion = 'https://www.notion.so/02-002-0123456789abcdef0123456789abcdef';
    expect(interpretarQR(notion)).toEqual({ tipo: 'codigo_sistema', valor: '02-002' });
  });

  it('devuelve null si no matchea ningún formato conocido', () => {
    expect(interpretarQR('cualquier texto sin id')).toBeNull();
  });
});

describe('interpretarQR — QR de individuo (/individuo/<uuid>)', () => {
  const OTRO = '11111111-2222-3333-4444-555555555555';

  it('interpreta la URL completa del individuo (etiquetas grande/mediana)', () => {
    expect(interpretarQR(`https://app.ejemplo.com/individuo/${UUID}`)).toEqual({ tipo: 'individuo', valor: UUID });
  });

  it('interpreta el path sin origen (etiqueta pequeña)', () => {
    expect(interpretarQR(`/individuo/${UUID}`)).toEqual({ tipo: 'individuo', valor: UUID });
  });

  it('normaliza a minúsculas el UUID del individuo', () => {
    expect(interpretarQR(`/individuo/${UUID.toUpperCase()}`)).toEqual({ tipo: 'individuo', valor: UUID });
  });

  it('tolera una barra final, query o ancla después del UUID', () => {
    expect(interpretarQR(`/individuo/${UUID}/`)).toEqual({ tipo: 'individuo', valor: UUID });
    expect(interpretarQR(`https://app.ejemplo.com/individuo/${UUID}?x=1`)).toEqual({ tipo: 'individuo', valor: UUID });
    expect(interpretarQR(`https://app.ejemplo.com/individuo/${UUID}#fila`)).toEqual({ tipo: 'individuo', valor: UUID });
  });

  it('PRECEDENCIA: /individuo/ se evalúa antes que el UUID pelado (si no, se leería como cruce)', () => {
    // Esta es la regresión que importa: la URL de un individuo contiene un UUID.
    expect(interpretarQR(`/individuo/${UUID}`)).not.toEqual({ tipo: 'id', valor: UUID });
    // Con dos UUID en el texto, manda el que va dentro del segmento /individuo/.
    expect(interpretarQR(`https://x.cl/planta/${OTRO}/individuo/${UUID}`)).toEqual({ tipo: 'individuo', valor: UUID });
  });

  it('INVARIANTE: un UUID pelado sigue siendo un CRUCE (etiquetas pequeñas ya impresas)', () => {
    expect(interpretarQR(UUID)).toEqual({ tipo: 'id', valor: UUID });
  });

  it('las URL de cruce (/planta/<uuid>) no se confunden con individuo', () => {
    expect(interpretarQR(`https://app.ejemplo.com/planta/${UUID}`)).toEqual({ tipo: 'id', valor: UUID });
    expect(interpretarQR(`/planta/${UUID}`)).toEqual({ tipo: 'id', valor: UUID });
  });

  it('el formato de Notion no cambia', () => {
    const notion = 'https://www.notion.so/02-002-0123456789abcdef0123456789abcdef';
    expect(interpretarQR(notion)).toEqual({ tipo: 'codigo_sistema', valor: '02-002' });
  });

  it('rechaza /individuo/ con un UUID malformado o sin UUID', () => {
    expect(interpretarQR('/individuo/')).toBeNull();
    expect(interpretarQR('/individuo/no-es-un-uuid')).toBeNull();
    expect(interpretarQR(`/individuo/${UUID.slice(0, -1)}`)).toBeNull();
  });

  it('no acepta un segmento parecido (p. ej. /individuos/ o /xindividuo/)', () => {
    expect(interpretarQR(`/individuos/${UUID}`)).toEqual({ tipo: 'id', valor: UUID });
    expect(interpretarQR(`/xindividuo/${UUID}`)).toEqual({ tipo: 'id', valor: UUID });
  });
});
