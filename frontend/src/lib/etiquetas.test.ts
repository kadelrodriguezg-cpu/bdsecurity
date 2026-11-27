import { describe, expect, it } from 'vitest';
import { etiquetaRol, etiquetaTipoProcedimiento } from './etiquetas';

describe('hallazgo 9: etiquetas legibles desde una sola función', () => {
  it('los tipos de procedimiento llevan mayúscula y tilde', () => {
    expect(etiquetaTipoProcedimiento('poda')).toBe('Poda');
    expect(etiquetaTipoProcedimiento('fertilizacion')).toBe('Fertilización');
    expect(etiquetaTipoProcedimiento('aplicacion')).toBe('Aplicación');
  });

  it('los roles se leen como en el menú de cuenta', () => {
    expect(etiquetaRol('admin')).toBe('Administrador');
    expect(etiquetaRol('operario')).toBe('Operario');
  });
});
