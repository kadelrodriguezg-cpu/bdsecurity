/**
 * Funcionalidades que se despliegan ocultas. La migración y el código viajan
 * con el despliegue; la ruta y el enlace del menú aparecen al cambiar la
 * constante.
 */

/**
 * Importador masivo de cruzamientos (B1). Oculto hasta resolver el backlog de
 * la auditoría 2026-10: codificación Windows-1252, códigos que Excel convierte
 * en fechas, casi-duplicados dentro del archivo y revertir_importacion sobre
 * cruces con trabajo de campo.
 */
export const IMPORTADOR_CRUCES_VISIBLE = false;
