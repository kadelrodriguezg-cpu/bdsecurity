/**
 * Fuente única para coordinar caché e invalidaciones de los flujos
 * científicos. Evita que una mutación refresque una clave parecida, pero no
 * la que consume la pantalla visible.
 */
export const qk = {
  especies: { all: ['especies'] as const },
  perfiles: { all: ['perfiles'] as const },
  chat: {
    canales: ['chat', 'canales'] as const,
    destino: (tipo: 'general' | 'cruce' | 'predio', entidadId?: string) => ['chat', 'destino', tipo, entidadId ?? ''] as const,
    participantes: (canalId: string) => ['chat', 'participantes', canalId] as const,
    notificaciones: ['chat', 'notificaciones'] as const,
  },
  variedades: { porEspecie: (especieId: string) => ['variedades', especieId] as const },
  plantas: {
    all: ['plantas'] as const,
    conteo: ['plantas', 'conteo'] as const,
    // Bajo «plantas» a propósito: lo que invalida los cruces también refresca el panorama de especies.
    panorama: (filtros: { especieId?: string; incluirPruebas: boolean }) => ['plantas', 'panorama', filtros] as const,
    lista: (filtros?: unknown) => filtros === undefined
      ? ['plantas'] as const
      : ['plantas', filtros] as const,
  },
  planta: { detalle: (id: string) => ['planta', id] as const },
  individuos: {
    all: ['individuos'] as const,
    lista: (plantaId: string) => ['individuos', plantaId] as const,
    resumen: (plantaId: string) => ['individuos', plantaId, 'resumen'] as const,
    resuelto: (individuoId: string) => ['individuos', 'resuelto', individuoId] as const,
  },
  scoring: { planta: (plantaId: string) => ['scoring', plantaId] as const },
  esquemaFase: (fase: string) => ['esquemaFase', fase] as const,
  // Fase 4: qué descriptores usa cada especie (sin especie = la configuración de todas) y la especie de un cruce.
  descriptoresEspecie: (especieId?: string) => (especieId ? ['descriptoresEspecie', especieId] : ['descriptoresEspecie']) as readonly string[],
  especieDeCruce: (plantaId: string) => ['especieDeCruce', plantaId] as const,
  // Fase 5 (G2): etiquetas de temporada (julio a junio) por cruce y por especie.
  temporadas: (especieId?: string) => (especieId ? ['temporadas', especieId] : ['temporadas']) as readonly string[],
  protocolo: {
    // La serie multisitio añade su sufijo; la anual conserva su clave de siempre.
    planilla: (plantaId: string, numeroRonda?: number, tipo: 'anual' | 'multisitio' = 'anual') =>
      (tipo === 'anual' ? ['protocolo', 'planilla', plantaId, numeroRonda ?? 'actual'] : ['protocolo', 'planilla', plantaId, numeroRonda ?? 'actual', tipo]) as readonly unknown[],
    vigente: (plantaId: string, numeroRonda: number, tipo: 'anual' | 'multisitio' = 'anual') =>
      (tipo === 'anual' ? ['protocolo', 'vigente', plantaId, numeroRonda] : ['protocolo', 'vigente', plantaId, numeroRonda, tipo]) as readonly unknown[],
    estados: (evaluacionId: string) => ['protocolo', 'estados', evaluacionId] as const,
    valores: (plantaId: string, numeroRonda: number, tipo: 'anual' | 'multisitio' = 'anual') => ['protocolo', 'valores', plantaId, numeroRonda, tipo] as const,
    porId: (protocoloId: string) => ['protocolo', 'id', protocoloId] as const,
    all: ['protocolo'] as const,
  },
  ranking: {
    all: ['ranking'] as const,
    planta: (plantaId: string, pagina: number, orden: string) => ['ranking', 'planta', plantaId, pagina, orden] as const,
    especie: (especieId: string, pagina: number, orden: string) => ['ranking', 'especie', especieId, pagina, orden] as const,
    global: (filtros: unknown) => ['ranking', 'global', filtros] as const,
    categorias: (alcance: unknown) => ['ranking', 'categorias', alcance] as const,
    grupos: (alcance: unknown) => ['ranking', 'grupos', alcance] as const,
    valoresParametros: (alcance: unknown) => ['ranking', 'valores-parametros', alcance] as const,
    polinizacionVarietal: (especieId?: string, rol?: 'ambos' | 'mama' | 'papa') => especieId === undefined
      ? ['ranking', 'polinizacion-varietal'] as const
      : ['ranking', 'polinizacion-varietal', especieId, rol ?? 'ambos'] as const,
  },
  comparacion: {
    all: ['comparacion-rondas'] as const,
    planta: (plantaId: string) => ['comparacion-rondas', 'planta', plantaId] as const,
    individuo: (individuoId: string) => ['comparacion-rondas', 'individuo', individuoId] as const,
    rondasIndividuo: (individuoId: string) => ['comparacion-rondas', 'rondas', individuoId] as const,
    congelados: (individuoId: string) => ['comparacion-rondas', 'congelados', individuoId] as const,
  },
  snapshots: {
    all: ['snapshots'] as const,
    lista: (alcance: unknown) => ['snapshots', 'lista', alcance] as const,
    detalle: (snapshotId: string) => ['snapshots', 'detalle', snapshotId] as const,
    comparacion: (snapshotId: string) => ['snapshots', 'comparacion', snapshotId] as const,
    cobertura: (snapshotId: string) => ['snapshots', 'cobertura', snapshotId] as const,
  },
  actividad: { planta: (plantaId: string) => ['actividad-reciente', plantaId] as const },
  dashboard: {
    all: ['dashboard-cientifico'] as const,
    cientifico: (especieId: string) => ['dashboard-cientifico', especieId] as const,
  },
  adminCruces: {
    all: ['admin-cruces'] as const,
    resumenBorrado: (plantaId: string) => ['resumen-borrado', plantaId] as const,
  },
  catalogos: {
    contenedores: {
      admin: ['admin-contenedores'] as const,
      activos: ['catalogo-contenedores'] as const,
      historial: ['catalogo-contenedores-historial'] as const,
    },
    insumos: {
      admin: ['admin-insumos'] as const,
      activos: ['catalogo-insumos'] as const,
      historial: ['catalogo-insumos-historial'] as const,
    },
    predios: {
      admin: ['admin-predios'] as const,
      activos: ['catalogo-predios'] as const,
      historial: ['catalogo-predios-historial'] as const,
    },
    sustratos: {
      admin: ['admin-sustratos'] as const,
      activos: ['catalogo-sustratos'] as const,
      historial: ['catalogo-sustratos-historial'] as const,
    },
  },
  auditoria: {
    planta: (plantaId: string) => ['auditoria', plantaId] as const,
    resumen: (plantaId: string) => ['auditoria', plantaId, 'resumen'] as const,
    bitacora: (plantaId: string, filtro: unknown) => ['auditoria', plantaId, filtro] as const,
  },
  fase: { datos: (plantaId: string) => ['fase', plantaId] as const },
  eventos: { planta: (plantaId: string) => ['eventos', plantaId] as const },
  germinacion: { planta: (plantaId: string) => ['germinacion', plantaId] as const },
  procedimientos: { planta: (plantaId: string) => ['procedimientos', plantaId] as const },
  procedimientoPredios: { activos: (plantaId: string) => ['procedimientos', plantaId, 'predios-activos'] as const },
  cosecha: { frutos: (plantaId: string) => ['cosecha-frutos', plantaId] as const },
  siembra: {
    insumos: (plantaId: string) => ['siembra-insumos', plantaId] as const,
    sustratos: (plantaId: string) => ['siembra-sustratos', plantaId] as const,
    nota: (plantaId: string) => ['siembra-nota', plantaId] as const,
  },
  polinizacion: {
    nota: (plantaId: string) => ['polinizacion-nota', plantaId] as const,
    eventos: (plantaId: string) => ['polinizacion-eventos', plantaId] as const,
  },
  resumenFinal: {
    all: ['resumen-final'] as const,
    planta: (plantaId: string) => ['resumen-final', plantaId] as const,
  },
  media: { urlFirmada: (archivoId: string) => ['url-firmada', archivoId] as const },
  evaluacionReducida: {
    /** Evaluaciones reducidas de toda una fase de un cruce (planilla de Crecimiento). */
    cruce: (plantaId: string, fase: string) => ['evaluacion-reducida', 'cruce', plantaId, fase] as const,
    individuo: (individuoId: string, fase: string) => ['evaluacion-reducida', individuoId, fase] as const,
    all: (individuoId: string) => ['evaluacion-reducida', individuoId] as const,
  },
  rondas: {
    individuo: (individuoId: string, tipo: 'anual' | 'multisitio' = 'anual') => ['rondas', individuoId, tipo] as const,
  },
  evaluaciones: {
    ronda: (rondaId: string) => ['evaluaciones', rondaId] as const,
    borrador: (rondaId: string) => ['evaluaciones', 'borrador', rondaId] as const,
    referencias: (rondaId: string, fecha: string) => ['evaluaciones', 'referencias', rondaId, fecha] as const,
    porId: (evaluacionId: string) => ['evaluaciones', 'id', evaluacionId] as const,
    /** v3 (A8): historial de correcciones de las evaluaciones de un individuo. */
    correcciones: (individuoId: string) => ['evaluaciones', 'correcciones', individuoId] as const,
    /** Fase 5 (G15): pedidos de corrección de una evaluación. */
    pedidos: (evaluacionId: string) => ['evaluaciones', 'pedidos', evaluacionId] as const,
    /** Fase 5 (G15): pedidos abiertos para el Inicio del admin. */
    pedidosAbiertos: ['evaluaciones', 'pedidos-abiertos'] as const,
  },
  evecl: {
    all: ['evecl'] as const,
    ensayos: ['evecl', 'ensayos'] as const,
    ensayo: (ensayoId: number) => ['evecl', 'ensayos', ensayoId] as const,
    fichasAll: ['evecl', 'fichas'] as const,
    fichasEnsayo: (ensayoId: number) => ['evecl', 'fichas', ensayoId] as const,
    fichas: (ensayoId: number, variedad?: string) => ['evecl', 'fichas', ensayoId, variedad ?? 'todas'] as const,
    ficha: (fichaId: number) => ['evecl', 'ficha', fichaId] as const,
    catalogo: ['evecl', 'catalogo'] as const,
    comparaciones: ['evecl', 'comparaciones'] as const,
    comparacion: (filtros: unknown) => ['evecl', 'comparaciones', filtros] as const,
    fotos: ['evecl', 'fotos'] as const,
    foto: (path: string) => ['evecl', 'fotos', path] as const,
  },
  pcr: { ronda: (rondaId: string) => ['pcr', rondaId] as const },
  baja: {
    motivos: (individuoId: string) => ['baja-motivos', individuoId] as const,
    previsualizacionLote: (ids: string[]) => ['baja-lote', 'previsualizacion', [...ids].sort()] as const,
  },
  territorio: {
    emplazamientos: (individuoId: string) => ['territorio', 'emplazamientos', individuoId] as const,
    sectores: ['territorio', 'sectores'] as const,
    mapaAgregadoAll: ['territorio', 'mapa-agregado'] as const,
    mapaAgregado: (filtros: unknown) => ['territorio', 'mapa-agregado', filtros] as const,
    mapaCruceAll: ['territorio', 'mapa-cruce'] as const,
    mapaCruce: (plantaId: string) => ['territorio', 'mapa-cruce', plantaId] as const,
    viewportAll: ['territorio', 'viewport'] as const,
    viewport: (filtros: unknown) => ['territorio', 'viewport', filtros] as const,
    climaCruce: (plantaId: string) => ['territorio', 'clima-cruce', plantaId] as const,
  },
  visualizacion: {
    seriesAll: ['visualizacion', 'series'] as const,
    series: (filtros: unknown) => ['visualizacion', 'series', filtros] as const,
  },
} as const;
