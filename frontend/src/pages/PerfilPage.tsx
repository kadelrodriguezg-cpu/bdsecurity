import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { actualizarMiNombre, cambiarMiPassword } from '@/api/perfiles';
import { useAuth } from '@/features/auth/AuthContext';
import { InterruptorSonidoApp, NotificacionesDispositivo } from '@/features/push/NotificacionesDispositivo';

const esquemaNombre = z.object({
  nombre: z.string().trim().min(2, 'Ingresa al menos 2 caracteres.').max(80, 'El nombre no puede superar 80 caracteres.'),
});

const esquemaPassword = z.object({
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
  confirmacion: z.string(),
}).refine((valores) => valores.password === valores.confirmacion, {
  message: 'Las contraseñas no coinciden.',
  path: ['confirmacion'],
});

type FormNombre = z.infer<typeof esquemaNombre>;
type FormPassword = z.infer<typeof esquemaPassword>;

export function PerfilPage() {
  const { user, perfil, recargarPerfil } = useAuth();
  const [resultadoNombre, setResultadoNombre] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [resultadoPassword, setResultadoPassword] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const nombreForm = useForm<FormNombre>({
    resolver: zodResolver(esquemaNombre),
    defaultValues: { nombre: perfil?.nombre ?? '' },
  });
  const passwordForm = useForm<FormPassword>({
    resolver: zodResolver(esquemaPassword),
    defaultValues: { password: '', confirmacion: '' },
  });

  useEffect(() => {
    nombreForm.reset({ nombre: perfil?.nombre ?? '' });
  }, [perfil?.nombre, nombreForm]);

  const guardarNombre = async ({ nombre }: FormNombre) => {
    setResultadoNombre(null);
    try {
      await actualizarMiNombre(nombre);
      await recargarPerfil();
      setResultadoNombre({ tipo: 'ok', texto: 'Nombre actualizado.' });
    } catch (error) {
      setResultadoNombre({
        tipo: 'error',
        texto: error instanceof Error ? error.message : 'No se pudo actualizar tu nombre.',
      });
    }
  };

  const guardarPassword = async ({ password }: FormPassword) => {
    setResultadoPassword(null);
    try {
      await cambiarMiPassword(password);
      passwordForm.reset();
      setResultadoPassword({ tipo: 'ok', texto: 'Contraseña actualizada.' });
    } catch (error) {
      setResultadoPassword({
        tipo: 'error',
        texto: error instanceof Error ? error.message : 'No se pudo actualizar tu contraseña.',
      });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Mi perfil</h1>
        <p className="mt-1 text-sm text-ink-3">Administra cómo aparece tu nombre y la seguridad de tu cuenta.</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos personales</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={nombreForm.handleSubmit(guardarNombre)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="perfil-email">Correo</Label>
                <Input id="perfil-email" type="email" value={user?.email ?? ''} readOnly disabled />
                <p className="text-xs text-ink-3">El correo identifica tu cuenta y no se cambia desde esta pantalla.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perfil-nombre">Nombre visible</Label>
                <Input id="perfil-nombre" autoComplete="name" {...nombreForm.register('nombre')} />
                {nombreForm.formState.errors.nombre && (
                  <p className="text-xs text-danger">{nombreForm.formState.errors.nombre.message}</p>
                )}
              </div>
              {resultadoNombre && (
                <Alert variant={resultadoNombre.tipo === 'ok' ? 'success' : 'error'}>{resultadoNombre.texto}</Alert>
              )}
              <Button type="submit" disabled={nombreForm.formState.isSubmitting}>
                {nombreForm.formState.isSubmitting ? 'Guardando…' : 'Guardar nombre'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cambiar contraseña</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={passwordForm.handleSubmit(guardarPassword)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="perfil-password">Nueva contraseña</Label>
                <Input
                  id="perfil-password"
                  type="password"
                  autoComplete="new-password"
                  {...passwordForm.register('password')}
                />
                {passwordForm.formState.errors.password && (
                  <p className="text-xs text-danger">{passwordForm.formState.errors.password.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perfil-confirmacion">Confirmar contraseña</Label>
                <Input
                  id="perfil-confirmacion"
                  type="password"
                  autoComplete="new-password"
                  {...passwordForm.register('confirmacion')}
                />
                {passwordForm.formState.errors.confirmacion && (
                  <p className="text-xs text-danger">{passwordForm.formState.errors.confirmacion.message}</p>
                )}
              </div>
              {resultadoPassword && (
                <Alert variant={resultadoPassword.tipo === 'ok' ? 'success' : 'error'}>{resultadoPassword.texto}</Alert>
              )}
              <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                {passwordForm.formState.isSubmitting ? 'Actualizando…' : 'Cambiar contraseña'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notificaciones de menciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <NotificacionesDispositivo />
            <div className="border-t border-line-soft pt-3">
              <InterruptorSonidoApp />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
