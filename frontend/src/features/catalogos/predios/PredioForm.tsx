import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Predio } from '@/api/catalogos';
import { PredioLocationPicker, type Coordenadas } from './PredioLocationPicker';
import { REGIONES_CHILE, type RegionChile } from './regionesChile';

export interface DatosPredioForm { nombre: string; coordenadas: Coordenadas; region: RegionChile | null }

export function PredioForm({ predio, guardando, alGuardar, alCancelar }: { predio?: Predio; guardando: boolean; alGuardar: (datos: DatosPredioForm) => void; alCancelar?: () => void }) {
  const [nombre, setNombre] = useState(predio?.nombre ?? '');
  const [coordenadas, setCoordenadas] = useState<Coordenadas>(predio?.latitud != null && predio.longitud != null ? { latitud: Number(predio.latitud), longitud: Number(predio.longitud) } : null);
  const [region, setRegion] = useState<RegionChile | null>(predio?.region ?? null);

  useEffect(() => {
    setNombre(predio?.nombre ?? '');
    setCoordenadas(predio?.latitud != null && predio.longitud != null ? { latitud: Number(predio.latitud), longitud: Number(predio.longitud) } : null);
    setRegion(predio?.region ?? null);
  }, [predio]);

  return <form onSubmit={(evento) => { evento.preventDefault(); alGuardar({ nombre: nombre.trim(), coordenadas, region }); }} className="space-y-4">
    <div className="space-y-1"><Label htmlFor="predio-nombre">Nombre</Label><Input id="predio-nombre" required value={nombre} onChange={(evento) => setNombre(evento.target.value)} /></div>
    <div className="space-y-1">
      <Label htmlFor="predio-region">Región</Label>
      <select id="predio-region" value={region ?? ''} onChange={(evento) => setRegion((evento.target.value || null) as RegionChile | null)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
        <option value="">Sin región</option>
        {REGIONES_CHILE.map((opcion) => <option key={opcion} value={opcion}>{opcion}</option>)}
      </select>
    </div>
    <PredioLocationPicker valor={coordenadas} alCambiar={setCoordenadas} alSugerirRegion={setRegion} />
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : predio ? 'Guardar cambios' : 'Guardar predio'}</Button>{alCancelar && <Button type="button" variant="outline" onClick={alCancelar} disabled={guardando}>Cancelar</Button>}</div>
  </form>;
}
