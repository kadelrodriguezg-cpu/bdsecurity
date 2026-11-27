/**
 * Gestión de usuarios (solo admin, protegida por AdminRoute + RLS).
 * Permite cambiar rol y permiso de linaje de OTROS usuarios. La fila propia
 * está deshabilitada a propósito: aunque el trigger del backend permite que
 * un admin se cambie a sí mismo, la decisión de habilitar el auto-cambio quedó
 * pendiente (ver comentario en migración 006) — hasta entonces la UI no lo ofrece.
 * El alta de usuarios nuevos se hace desde el dashboard de Supabase (fuera de alcance).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listarPerfiles, actualizarPermisos, type Perfil } from '@/api/perfiles';
import { useAuth } from '@/features/auth/AuthContext';
import type { RolUsuario } from '@/types/domain';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EncabezadoPagina, EstadoCargando, EstadoError } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';
import { etiquetaRol } from '@/lib/etiquetas';

interface ConfirmacionLinaje {
  perfil: Perfil;
  nuevoValor: boolean;
}

interface ConfirmacionRol {
  perfil: Perfil;
  nuevoValor: RolUsuario;
}

function ErrorCargaPerfiles({ error, reintentar }: { error: unknown; reintentar: () => void }) {
  const mensaje = error instanceof Error && error.message === 'Failed to fetch'
    ? 'No se pudo conectar para cargar los perfiles.'
    : 'No se pudieron cargar los perfiles. Revisa tus permisos e inténtalo nuevamente.';
  return <EstadoError titulo="No se pudieron cargar los usuarios" mensaje={mensaje} onReintentar={reintentar} />;
}

export function UsuariosPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmacionLinaje, setConfirmacionLinaje] = useState<ConfirmacionLinaje | null>(null);
  const [confirmacionRol, setConfirmacionRol] = useState<ConfirmacionRol | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);

  const { data: perfiles, isLoading, isError, error: errorCarga, refetch } = useQuery({
    queryKey: qk.perfiles.all,
    queryFn: listarPerfiles,
  });

  const mutacion = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: { rol?: RolUsuario; puede_ver_linaje?: boolean } }) =>
      actualizarPermisos(id, cambios),
    onSuccess: (_, variables) => {
      setError(null);
      setConfirmacionLinaje(null);
      setConfirmacionRol(null);
      setGuardado(
        variables.cambios.puede_ver_linaje === undefined
          ? 'Rol actualizado.'
          : `Permiso de linaje ${variables.cambios.puede_ver_linaje ? 'habilitado' : 'deshabilitado'}.`,
      );
      void queryClient.invalidateQueries({ queryKey: qk.perfiles.all });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo actualizar.'),
  });

  return (
    <div className="space-y-4">
      <EncabezadoPagina
        titulo="Usuarios"
        subtitulo="El alta de cuentas nuevas se hace desde el panel de Supabase; aquí se gestionan roles y permisos."
      />

      {error && <Alert>{error}</Alert>}
      {guardado && <Alert variant="success">{guardado}</Alert>}

      <Card>
        <CardHeader><CardTitle className="text-sm">Perfiles del sistema</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <EstadoCargando etiqueta="Cargando usuarios…" />}
          {isError && <ErrorCargaPerfiles error={errorCarga} reintentar={() => void refetch()} />}
          {!isError && <ul className="divide-y">
            {perfiles?.map((p: Perfil) => {
              const esYo = p.id === user?.id;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {p.nombre} {esYo && <span className="text-xs text-ink-3">(tú)</span>}
                    </p>
                    <div className="mt-1 flex gap-2">
                      <Badge variant={p.rol === 'admin' ? 'default' : 'outline'}>{etiquetaRol(p.rol)}</Badge>
                      {p.puede_ver_linaje && p.rol !== 'admin' && (
                        <Badge variant="outline">Puede ver linaje genético</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Select
                      value={p.rol}
                      disabled={esYo || isError || mutacion.isPending}
                      onChange={(e) => {
                        const nuevoValor = e.target.value as RolUsuario;
                        if (nuevoValor === p.rol) return;
                        setGuardado(null);
                        setConfirmacionLinaje(null);
                        setConfirmacionRol({ perfil: p, nuevoValor });
                      }}
                      className="h-9 w-40"
                      aria-label={`Rol de ${p.nombre}`}
                      title={esYo ? 'No puedes cambiar tu propio rol desde aquí' : undefined}
                    >
                      <option value="operario">{etiquetaRol('operario')}</option>
                      <option value="admin">{etiquetaRol('admin')}</option>
                    </Select>
                    <label className="flex items-center gap-1.5 text-xs text-ink-3">
                      <input
                        type="checkbox"
                        checked={p.puede_ver_linaje}
                        disabled={esYo || p.rol === 'admin' || isError || mutacion.isPending}
                        onChange={(e) => {
                          setGuardado(null);
                          setConfirmacionRol(null);
                          setConfirmacionLinaje({ perfil: p, nuevoValor: e.target.checked });
                        }}
                      />
                      Puede ver linaje genético
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>}
        </CardContent>
      </Card>

      <Modal
        open={confirmacionRol !== null}
        onClose={() => setConfirmacionRol(null)}
        title="Confirmar cambio de rol"
      >
        {confirmacionRol && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              Revisa el cambio antes de modificar los permisos de esta cuenta.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-line bg-surface-2 p-3 text-sm">
              <dt className="text-ink-3">Usuario</dt>
              <dd className="text-ink">{confirmacionRol.perfil.nombre}</dd>
              <dt className="text-ink-3">Rol actual</dt>
              <dd className="text-ink">{etiquetaRol(confirmacionRol.perfil.rol)}</dd>
              <dt className="text-ink-3">Rol nuevo</dt>
              <dd className="font-semibold text-ink">{etiquetaRol(confirmacionRol.nuevoValor)}</dd>
            </dl>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => mutacion.mutate({
                  id: confirmacionRol.perfil.id,
                  cambios: { rol: confirmacionRol.nuevoValor },
                })}
                disabled={mutacion.isPending}
              >
                {mutacion.isPending ? 'Guardando…' : 'Confirmar y guardar'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setConfirmacionRol(null)} disabled={mutacion.isPending}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={confirmacionLinaje !== null}
        onClose={() => setConfirmacionLinaje(null)}
        title="Confirmar permiso de linaje"
      >
        {confirmacionLinaje && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              {confirmacionLinaje.nuevoValor
                ? `¿Permitir que ${confirmacionLinaje.perfil.nombre} vea el linaje genético confidencial?`
                : `¿Quitar a ${confirmacionLinaje.perfil.nombre} el acceso al linaje genético?`}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => mutacion.mutate({
                  id: confirmacionLinaje.perfil.id,
                  cambios: { puede_ver_linaje: confirmacionLinaje.nuevoValor },
                })}
                disabled={mutacion.isPending}
              >
                {mutacion.isPending ? 'Guardando…' : 'Confirmar y guardar'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setConfirmacionLinaje(null)} disabled={mutacion.isPending}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
