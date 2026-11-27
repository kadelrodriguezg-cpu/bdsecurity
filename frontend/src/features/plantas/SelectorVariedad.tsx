/**
 * Combobox de progenitor (Mamá/Papá): busca en el catálogo de variedades de
 * la especie elegida, o crea una nueva inline si no existe (Bloque 3, Parte
 * 3C de la auditoría de UX). Reemplaza el <Input> de texto libre que tenían
 * NuevaPlantaPage y LinajePanel — mismo componente en los dos lugares donde
 * se escribe Mamá/Papá, para que "editar el linaje de un cruce existente"
 * no reabra la puerta al texto libre que este combobox viene a cerrar.
 *
 * No hay ningún combobox previo en el proyecto para reusar (los selectores
 * de catálogo existentes son todos <select> nativos contra listas cerradas,
 * sin alta inline) — este es deliberadamente simple: sin navegación por
 * teclado tipo ARIA combobox completo, solo texto + lista + click afuera
 * para cerrar. Si más adelante aparece un segundo caso de uso con "elegir
 * existente o crear nuevo", vale la pena generalizar este componente en vez
 * de escribir un tercero.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listarVariedades, crearVariedad } from '@/api/variedades';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/queryKeys';
import { claveNombreVariedad } from '@/lib/claveNombreVariedad';

export function SelectorVariedad({
  id,
  label,
  especieId,
  valorId,
  onCambiar,
}: {
  id: string;
  label: string;
  especieId: string | null;
  valorId: string | null;
  onCambiar: (variedadId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [avisarSinSeleccion, setAvisarSinSeleccion] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const invalidacionPropia = useRef(false);
  const especieAnterior = useRef(especieId);
  const revision = useRef(0);

  const { data: variedades } = useQuery({
    queryKey: [...qk.variedades.porEspecie(especieId ?? ''), 'todas'],
    queryFn: () => listarVariedades(especieId!, false),
    enabled: !!especieId,
  });

  const seleccionada = variedades?.find((v) => v.id === valorId) ?? null;

  // Sincroniza el texto visible con la selección real (ej. al cargar una
  // ficha ya guardada, o si el valorId cambia desde afuera).
  useEffect(() => {
    if (!seleccionada && invalidacionPropia.current) {
      invalidacionPropia.current = false;
      return;
    }
    setTexto(seleccionada?.nombre ?? '');
  }, [seleccionada?.id, seleccionada?.nombre]);

  useEffect(() => {
    if (especieAnterior.current === especieId) return;
    especieAnterior.current = especieId;
    revision.current += 1;
    invalidacionPropia.current = false;
    setTexto('');
    setError(null);
    setAvisarSinSeleccion(false);
    setAbierto(false);
    onCambiar(null);
  }, [especieId, onCambiar]);

  const disponibles = (variedades ?? []).filter((v) => v.activo || v.id === valorId);
  const textoNormalizado = texto.trim().toLowerCase();
  const claveTexto = claveNombreVariedad(texto);
  const parecida = claveTexto ? (variedades ?? []).find((v) => claveNombreVariedad(v.nombre) === claveTexto) : undefined;
  const exacta = disponibles.find((v) => v.nombre.trim().toLowerCase() === textoNormalizado);
  const exactaId = exacta?.id;
  const parecidaId = parecida?.activo ? parecida.id : undefined;
  const parecidaNombre = parecida?.nombre;
  const resolverTexto = useCallback(() => {
    if (exactaId) {
      onCambiar(exactaId);
      setAvisarSinSeleccion(false);
    } else if (parecidaId) {
      onCambiar(parecidaId);
      setTexto(parecidaNombre!);
      setAvisarSinSeleccion(false);
    } else {
      setAvisarSinSeleccion(texto.trim() !== '');
    }
    setAbierto(false);
  }, [exactaId, parecidaId, parecidaNombre, texto, onCambiar]);

  useEffect(() => {
    const alClickFuera = (evento: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target as Node)) resolverTexto();
    };
    document.addEventListener('mousedown', alClickFuera);
    return () => document.removeEventListener('mousedown', alClickFuera);
  }, [resolverTexto]);

  const coincidencias = disponibles.filter((v) => v.nombre.toLowerCase().includes(textoNormalizado) || v.id === parecida?.id);
  const coincidenciaExacta = !!exacta || !!parecida;

  const crear = useMutation({
    mutationFn: (entrada: { especie: string; nombre: string; revision: number }) => crearVariedad(entrada.especie, entrada.nombre),
    onSuccess: (nueva, entrada) => {
      void queryClient.invalidateQueries({ queryKey: qk.variedades.porEspecie(entrada.especie) });
      // Una respuesta tardía no puede asignar el progenitor a otra edición/especie.
      if (entrada.revision !== revision.current) return;
      setError(null);
      setAvisarSinSeleccion(false);
      onCambiar(nueva.id);
      setTexto(nueva.nombre);
      setAbierto(false);
    },
    onError: (e, entrada) => {
      if (entrada.revision === revision.current) setError(e instanceof Error ? e.message : 'No se pudo crear la variedad.');
    },
  });

  const elegir = (variedadId: string, nombre: string) => {
    revision.current += 1;
    setAvisarSinSeleccion(false);
    onCambiar(variedadId);
    setTexto(nombre);
    setAbierto(false);
  };

  return (
    <div className="relative space-y-1" ref={contenedorRef} onBlur={(evento) => {
      if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) resolverTexto();
    }}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        autoComplete="off"
        disabled={!especieId}
        placeholder={especieId ? 'Buscar o crear…' : 'Selecciona una especie primero'}
        value={texto}
        aria-describedby={avisarSinSeleccion && valorId === null ? `${id}-sin-seleccion` : undefined}
        onChange={(evento) => {
          const valor = evento.target.value;
          revision.current += 1;
          setTexto(valor);
          setAvisarSinSeleccion(false);
          setAbierto(true);
          if (valorId !== null || valor.trim() === '') {
            invalidacionPropia.current = valorId !== null;
            onCambiar(null);
          }
        }}
        onFocus={() => setAbierto(true)}
      />
      {abierto && especieId && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-md">
          {coincidencias.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2',
                  v.id === valorId && 'bg-brand-l text-brand-ink',
                )}
                onClick={() => elegir(v.id, v.nombre)}
              >
                {v.nombre}
              </button>
            </li>
          ))}
          {parecida && !parecida.activo && parecida.id !== valorId && (
            <li className="px-3 py-1.5 text-sm text-ink-3">Ya existe «{parecida.nombre}» (inactiva).</li>
          )}
          {texto.trim() !== '' && !coincidenciaExacta && (
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm font-medium text-primary hover:bg-surface-2"
                onClick={() => crear.mutate({ especie: especieId, nombre: texto.trim(), revision: revision.current })}
                disabled={crear.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
                {crear.isPending ? 'Creando…' : `Crear "${texto.trim()}" como nueva variedad`}
              </button>
            </li>
          )}
          {coincidencias.length === 0 && texto.trim() === '' && (
            <li className="px-3 py-1.5 text-sm text-ink-3">Escribe para buscar…</li>
          )}
        </ul>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {avisarSinSeleccion && valorId === null && texto.trim() !== '' && (
        <p id={`${id}-sin-seleccion`} role="status" className="text-xs text-danger">
          «{texto}» no está seleccionada: elígela de la lista o créala. Si la dejas así, el cruce se guarda sin {label}.
        </p>
      )}
    </div>
  );
}
