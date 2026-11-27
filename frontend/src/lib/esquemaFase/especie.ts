/**
 * El esquema de una fase tal como lo usa una especie (fase 4): un descriptor que la especie no usa queda como desactivado
 * (`activo: false`: no se ofrece en formularios ni protocolos, y los valores históricos se siguen mostrando) y las etiquetas
 * por nivel propias de la especie reemplazan a las del esquema.
 */
import type { ConfigDescriptorEspecie } from '@/api/descriptoresEspecie';
import type { EsquemaFase } from './tipos';

export function aplicarEspecie<Clave extends string>(esquema: EsquemaFase<Clave>, config: readonly ConfigDescriptorEspecie[]): EsquemaFase<Clave> {
  if (config.length === 0) return esquema;
  const porClave = new Map(config.map((c) => [c.clave, c]));
  return {
    ...esquema,
    campos: esquema.campos.map((campo) => {
      const propio = porClave.get(campo.clave);
      if (!propio) return campo;
      const niveles = propio.etiquetas_nivel;
      return {
        ...campo,
        ...(propio.activo ? {} : { activo: false }),
        ...(niveles && campo.escala && niveles.length === campo.escala.maximo - campo.escala.minimo + 1
          ? { escala: { ...campo.escala, etiquetasNivel: niveles, etiquetaMinimo: niveles[0], etiquetaMaximo: niveles[niveles.length - 1] } }
          : {}),
      };
    }),
  };
}
