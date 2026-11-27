/** Nombres de compañeros para «última actividad · quién» (N15: solo el nombre). Sin nombre, quien llama no escribe a nadie. */
import { useQuery } from '@tanstack/react-query';
import { nombresDeUsuarios } from '@/api/nombres';

export function useNombres(ids: Array<string | null | undefined>): Map<string, string> {
  const unicos = [...new Set(ids.filter((id): id is string => !!id))].sort();
  const { data } = useQuery({
    queryKey: ['nombres-usuarios', unicos],
    queryFn: () => nombresDeUsuarios(unicos),
    enabled: unicos.length > 0,
    staleTime: 300_000,
  });
  return data ?? new Map();
}
