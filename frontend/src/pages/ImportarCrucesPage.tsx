/**
 * Importación masiva de cruces (B1, solo admin). Flujo de tres pasos, mismo
 * patrón que DeltaBreed/Germinate: asignar columnas, previsualizar con errores
 * fila por fila, y confirmar en bloque (todo o nada, en la base). El archivo
 * se lee en el navegador; por ahora CSV (Excel: «Guardar como CSV»). XLSX
 * queda pendiente de elegir dependencia.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { FileUp, Undo2 } from 'lucide-react';
import {
  CAMPOS_IMPORTACION,
  CAMPOS_OBLIGATORIOS,
  CAMPO_IMPORTACION_LABEL,
  ERROR_IMPORTACION_LABEL,
  confirmarImportacion,
  descartarImportacion,
  previsualizarImportacion,
  revertirImportacion,
  type CampoImportacion,
  type FilaPrevisualizada,
  type Previsualizacion,
  type ResultadoImportacion,
} from '@/api/importacion';
import { leerCsv, type TablaCsv } from '@/lib/csv';
import { construirFilas, proponerAsignacion, type AsignacionColumnas } from '@/features/importacion/mapeoColumnas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { EncabezadoPagina } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';

function problemasDeFila(fila: FilaPrevisualizada): string[] {
  const problemas = fila.errores.map((e) => ERROR_IMPORTACION_LABEL[e] ?? e);
  if (fila.sugerencias.mama) problemas.push(`¿Mamá «${fila.sugerencias.mama}»?`);
  if (fila.sugerencias.papa) problemas.push(`¿Papá «${fila.sugerencias.papa}»?`);
  // Mamá y papá pueden ser la misma variedad nueva: se nombra una vez.
  for (const nombre of new Set(fila.variedades_faltantes)) problemas.push(`Variedad nueva: ${nombre}`);
  return problemas;
}

export function ImportarCrucesPage() {
  const queryClient = useQueryClient();
  const [archivo, setArchivo] = useState<{ nombre: string; tabla: TablaCsv } | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [asignacion, setAsignacion] = useState<AsignacionColumnas>({});
  const [preview, setPreview] = useState<Previsualizacion | null>(null);
  const [crearVariedades, setCrearVariedades] = useState(false);
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [revertido, setRevertido] = useState<number | null>(null);

  const faltanObligatorios = CAMPOS_OBLIGATORIOS.filter((campo) => asignacion[campo] === undefined);

  const reiniciarPreview = async () => {
    if (preview && !resultado) {
      try {
        await descartarImportacion(preview.lote_id);
      } catch (error) {
        setErrorArchivo(error instanceof Error ? error.message : 'No se pudo descartar la previsualización.');
        return false;
      }
    }
    setPreview(null);
    setResultado(null);
    setRevertido(null);
    setCrearVariedades(false);
    return true;
  };

  const elegirArchivo = async (file: File | undefined) => {
    if (!await reiniciarPreview()) return;
    setErrorArchivo(null);
    if (!file) return setArchivo(null);
    const tabla = leerCsv(await file.text());
    if (tabla.columnas.length === 0 || tabla.filas.length === 0) {
      setArchivo(null);
      setErrorArchivo('El archivo no tiene cabecera o no trae filas.');
      return;
    }
    setArchivo({ nombre: file.name, tabla });
    setAsignacion(proponerAsignacion(tabla.columnas));
  };

  const previsualizar = useMutation({
    mutationFn: async () => {
      if (preview && !resultado) await descartarImportacion(preview.lote_id);
      return previsualizarImportacion(construirFilas(archivo!.tabla.filas, asignacion), archivo!.nombre);
    },
    onSuccess: (data) => {
      setPreview(data);
      setClave(crypto.randomUUID());
    },
  });

  const confirmar = useMutation({
    mutationFn: () => confirmarImportacion(preview!.lote_id, crearVariedades, clave),
    onSuccess: (data) => {
      setResultado(data);
      void queryClient.invalidateQueries({ queryKey: qk.plantas.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
    },
  });

  const revertir = useMutation({
    mutationFn: () => revertirImportacion(resultado!.lote_id),
    onSuccess: (data) => {
      setRevertido(data.cruces_archivados);
      void queryClient.invalidateQueries({ queryKey: qk.plantas.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
    },
  });

  const filasConProblemas = preview?.filas.filter((f) => problemasDeFila(f).length > 0) ?? [];
  const hayVariedadesNuevas = (preview?.variedades_nuevas.length ?? 0) > 0;
  const puedeConfirmar = !!preview && preview.filas_con_error === 0 && (!hayVariedadesNuevas || crearVariedades) && !resultado;

  return (
    <div className="max-w-3xl space-y-4">
      <EncabezadoPagina titulo="Importar cruces" subtitulo="Carga masiva desde un CSV. Nada se crea hasta confirmar, y se crea todo o nada." />

      <Card>
        <CardHeader><CardTitle className="text-sm">1. Archivo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="archivo-cruces">Archivo CSV (desde Excel: «Guardar como» → CSV)</Label>
          <Input id="archivo-cruces" type="file" accept=".csv,text/csv" onChange={(e) => void elegirArchivo(e.target.files?.[0])} />
          {errorArchivo && <Alert>{errorArchivo}</Alert>}
          {archivo && <p className="text-small text-ink-3">{archivo.nombre}: {archivo.tabla.filas.length} fila(s).</p>}
        </CardContent>
      </Card>

      {archivo && (
        <Card>
          <CardHeader><CardTitle className="text-sm">2. Columnas</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPOS_IMPORTACION.map((campo: CampoImportacion) => (
                <div key={campo} className="space-y-1">
                  <Label htmlFor={`col-${campo}`}>
                    {CAMPO_IMPORTACION_LABEL[campo]}{CAMPOS_OBLIGATORIOS.includes(campo) ? ' *' : ''}
                  </Label>
                  <Select
                    id={`col-${campo}`}
                    value={asignacion[campo] ?? ''}
                    onChange={async (e) => {
                      const valor = e.target.value;
                      if (!await reiniciarPreview()) return;
                      setAsignacion((prev) => ({ ...prev, [campo]: valor === '' ? undefined : Number(valor) }));
                    }}
                  >
                    <option value="">— Sin columna —</option>
                    {archivo.tabla.columnas.map((columna, i) => (
                      <option key={`${columna}-${i}`} value={i}>{columna || `Columna ${i + 1}`}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {faltanObligatorios.length > 0 && (
              <p className="text-small text-ink-3">
                Falta asignar: {faltanObligatorios.map((c) => CAMPO_IMPORTACION_LABEL[c]).join(', ')}.
              </p>
            )}
            <Button onClick={() => previsualizar.mutate()} disabled={faltanObligatorios.length > 0 || previsualizar.isPending}>
              <FileUp className="h-4 w-4" />
              {previsualizar.isPending ? 'Revisando…' : 'Previsualizar'}
            </Button>
            {previsualizar.isError && <Alert>{previsualizar.error.message}</Alert>}
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader><CardTitle className="text-sm">3. Revisión y confirmación</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {preview.filas_total} fila(s) · <strong>{preview.filas_con_error}</strong> con errores
              {hayVariedadesNuevas && <> · {preview.variedades_nuevas.length} variedad(es) nueva(s)</>}
            </p>

            {filasConProblemas.length > 0 && (
              <div className="max-h-80 overflow-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-surface">
                    {/* Línea del archivo tal como la ve el admin en Excel: la 1 es la cabecera. */}
                    <tr><th className="px-2 py-1.5">Línea</th><th className="px-2 py-1.5">Código</th><th className="px-2 py-1.5">Revisar</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {filasConProblemas.map((fila) => (
                      <tr key={fila.n} className={fila.errores.length > 0 ? 'text-danger' : undefined}>
                        <td className="px-2 py-1.5">{fila.n + 1}</td>
                        <td className="px-2 py-1.5 font-mono">{fila.codigo_sistema ?? '—'}</td>
                        <td className="px-2 py-1.5">{problemasDeFila(fila).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.filas_con_error > 0 ? (
              <Alert>Corrige las filas marcadas en el archivo y vuelve a cargarlo. No se creó nada.</Alert>
            ) : (
              <>
                {hayVariedadesNuevas && (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={crearVariedades} onChange={(e) => setCrearVariedades(e.target.checked)} disabled={!!resultado} />
                    <span>Crear las variedades nuevas: {preview.variedades_nuevas.join(', ')}</span>
                  </label>
                )}
                <Button onClick={() => confirmar.mutate()} disabled={!puedeConfirmar || confirmar.isPending}>
                  {confirmar.isPending ? 'Importando…' : `Confirmar e importar ${preview.filas_total} cruce(s)`}
                </Button>
              </>
            )}
            {confirmar.isError && <Alert>{confirmar.error.message}</Alert>}

            {resultado && (
              <div className="space-y-2">
                <Alert variant="success">
                  Se importaron {resultado.cruces_creados} cruce(s)
                  {resultado.variedades_creadas > 0 && <> y {resultado.variedades_creadas} variedad(es)</>}.{' '}
                  <Link to="/plantas" className="underline">Ver cruces</Link>
                </Alert>
                {revertido === null ? (
                  <Button variant="outline" size="sm" onClick={() => revertir.mutate()} disabled={revertir.isPending}>
                    <Undo2 className="h-3.5 w-3.5" /> Revertir esta importación
                  </Button>
                ) : (
                  <Alert variant="success">Se archivaron {revertido} cruce(s) del lote.</Alert>
                )}
                {revertir.isError && <Alert>{revertir.error.message}</Alert>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
