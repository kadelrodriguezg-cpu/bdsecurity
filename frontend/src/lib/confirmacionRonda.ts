export function mensajeInicioRonda(numero: number, tipo: 'anual' | 'multisitio'): string {
  return `¿Iniciar ronda ${tipo === 'multisitio' ? 'multisitio ' : ''}${numero}? Usará una de las 3 rondas de esta serie. La nueva ronda pasa a ser la actual y puede dejar al individuo fuera del ranking hasta completar su evaluación. No puede anularse desde la app.`;
}
