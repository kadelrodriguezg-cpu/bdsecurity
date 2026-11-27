import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, LoaderCircle } from 'lucide-react';
import { chat } from '@/api/chat';
import { listarPerfiles } from '@/api/perfiles';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { qk } from '@/lib/queryKeys';
import type { CanalChat } from '@/types/chat';

export function CanalLibreModal({
  open,
  canal,
  usuarioId,
  onCerrar,
  onGuardado,
}: {
  open: boolean;
  canal?: CanalChat;
  usuarioId: string;
  onCerrar: () => void;
  onGuardado: (canalId: string) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editando = !!canal;
  const perfiles = useQuery({ queryKey: qk.perfiles.all, queryFn: listarPerfiles, enabled: open });
  const participantes = useQuery({
    queryKey: qk.chat.participantes(canal?.id ?? ''),
    queryFn: () => chat.listarParticipantes(canal!.id),
    enabled: open && editando,
  });

  useEffect(() => {
    if (!open) return;
    setNombre(canal?.entidad_nombre ?? '');
    setError(null);
    if (!canal) setSeleccionados([usuarioId]);
  }, [canal, open, usuarioId]);

  useEffect(() => {
    if (participantes.data) setSeleccionados(participantes.data.map((perfil) => perfil.id));
  }, [participantes.data]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      if (canal) {
        await chat.actualizarParticipantes(canal.id, seleccionados);
        onGuardado(canal.id);
      } else {
        const canalId = await chat.crearCanalLibre(nombre, seleccionados);
        onGuardado(canalId);
      }
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo guardar el canal.');
    } finally {
      setGuardando(false);
    }
  }

  async function archivar() {
    if (!canal || !window.confirm(`¿Archivar el canal “${canal.entidad_nombre}”? El historial quedará en modo solo lectura.`)) return;
    setGuardando(true);
    setError(null);
    try {
      await chat.archivarCanalLibre(canal.id);
      onGuardado(canal.id);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo archivar el canal.');
    } finally {
      setGuardando(false);
    }
  }

  const cargando = perfiles.isLoading || (editando && participantes.isLoading);
  return (
    <Modal
      open={open}
      onClose={onCerrar}
      title={editando ? 'Gestionar canal' : 'Nuevo canal libre'}
      hayContenido={!editando && (!!nombre.trim() || seleccionados.some((id) => id !== usuarioId))}
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="space-y-1.5">
          <Label htmlFor="nombre-canal-libre">Nombre</Label>
          <Input
            id="nombre-canal-libre"
            value={nombre}
            maxLength={80}
            disabled={editando || guardando}
            placeholder="Ej. Equipo temporada 2027"
            onChange={(evento) => setNombre(evento.target.value)}
          />
          {!editando && <p className="text-small text-ink-3">Quedarás incluido como creador y responsable del canal.</p>}
        </div>

        <fieldset className="space-y-2" disabled={cargando || guardando || canal?.archivado}>
          <legend className="text-sm font-semibold">Participantes</legend>
          {cargando ? (
            <p className="flex items-center gap-2 text-sm text-ink-3"><LoaderCircle className="h-4 w-4 animate-spin" />Cargando perfiles…</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-line p-2">
              {perfiles.data?.map((perfil) => {
                const esCreador = perfil.id === (canal?.creado_por ?? usuarioId);
                const marcado = seleccionados.includes(perfil.id) || esCreador;
                return (
                  <label key={perfil.id} className="flex min-h-tap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={esCreador}
                      onChange={(evento) => setSeleccionados((actuales) => evento.target.checked
                        ? [...new Set([...actuales, perfil.id])]
                        : actuales.filter((id) => id !== perfil.id))}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{perfil.nombre}</span>
                    {esCreador && <span className="text-small text-ink-3">Creador</span>}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <div>
            {canal && !canal.archivado && (
              <Button type="button" variant="destructive" size="sm" onClick={() => void archivar()} disabled={guardando}>
                <Archive className="h-4 w-4" />Archivar canal
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
            {!canal?.archivado && (
              <Button type="button" onClick={() => void guardar()} disabled={guardando || cargando || (!editando && nombre.trim().length < 2)}>
                {guardando && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {editando ? 'Guardar participantes' : 'Crear canal'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
