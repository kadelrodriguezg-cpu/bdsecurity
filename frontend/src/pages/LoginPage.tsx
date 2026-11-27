import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { destinoInterno } from '@/lib/destinoInterno';
import { contarBorradoresDe, leerSesionExpirada } from '@/lib/borradoresSesion';

const esquema = z.object({
  email: z.string().email('Ingresa un email válido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
});
type FormLogin = z.infer<typeof esquema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [parametros] = useSearchParams();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // U-01: si la sesión caducó (no un cierre manual), se avisa y, si quedó un
  // borrador de esa persona en este equipo, que sigue guardado. Tras entrar,
  // `next` devuelve a la ruta donde estaba.
  const [sesionExpirada] = useState(() => {
    const aviso = leerSesionExpirada();
    return aviso ? { conBorrador: contarBorradoresDe(aviso.usuarioId) > 0 } : null;
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormLogin>({ resolver: zodResolver(esquema) });

  const onSubmit = async (valores: FormLogin) => {
    setErrorGeneral(null);
    try {
      await login(valores.email, valores.password);
      navigate(destinoInterno(parametros.get('next')), { replace: true });
    } catch (error) {
      setErrorGeneral(error instanceof Error && error.message === 'Email o contraseña incorrectos.'
        ? 'Email o contraseña incorrectos.'
        : 'No se pudo iniciar sesión. Revisa tu email, contraseña y conexión e intenta de nuevo.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src="/brand-logo.png" alt="BDSecurity" className="h-20 w-20" />
          <CardTitle className="text-lg">BDSecurity</CardTitle>
          <p className="text-sm text-ink-3">Inicia sesión para continuar</p>
        </CardHeader>
        <CardContent>
          {sesionExpirada && (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-md border border-line bg-surface-2 p-3 text-sm text-ink-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                {sesionExpirada.conBorrador
                  ? 'Tu sesión expiró; tu evaluación sigue guardada en este equipo.'
                  : 'Tu sesión expiró. Vuelve a iniciar sesión.'}
              </p>
            </div>
          )}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} {...register('email')} />
              {errors.email && <p id="email-error" className="text-xs text-danger">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} {...register('password')} />
              {errors.password && <p id="password-error" className="text-xs text-danger">{errors.password.message}</p>}
            </div>
            {errorGeneral && <Alert>{errorGeneral}</Alert>}
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
