import { AlertTriangle, BookOpen, CircleHelp, Scale } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EveclEncabezado } from '@/features/evecl/EveclEncabezado';

// Los 7 descriptores con fila propia en el catálogo (evecl_descriptor.rankeable
// = true). La Relación °Brix/Acidez NO va acá: es un criterio derivado sin fila
// propia, calculado en la RPC evecl_comparar a partir de Dulzor + Acidez — ver
// la tarjeta "Relación °Brix/Acidez: criterio derivado" más abajo. Mezclarlo en
// esta lista como un descriptor más es exactamente la confusión que esta
// pantalla existe para evitar (contaba 8 donde el catálogo real tiene 7).
const CRITERIOS = [
  ['Firmeza', 'Calidad', 'Mayor es mejor'],
  ['Dulzor (°Brix)', 'Calidad', 'Mayor es mejor'],
  ['Tamaño cicatriz peduncular', 'Calidad', 'Menor es mejor'],
  ['Tamaño del fruto (UPOV 20)', 'Calidad', 'Mayor es mejor'],
  ['Rendimiento (g/planta)', 'Productividad', 'Mayor es mejor'],
  ['Días de postcosecha', 'Productividad', 'Mayor es mejor'],
  ['Densidad de infrutescencia (UPOV 18)', 'Productividad', 'Mayor es mejor'],
] as const;

export function EveclReferenciaPage() {
  return (
    <div className="space-y-5">
      <EveclEncabezado titulo="Metodología EVECL" descripcion="Cómo leer el ranking, sus exclusiones y sus límites." />

      <Card className="space-y-3 border-t-4 border-t-brand p-4">
        <div className="flex items-start gap-3">
          <Scale className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div>
            <h2 className="font-semibold">Un puntaje relativo, no una nota de mercado</h2>
            <p className="mt-1 text-sm text-ink-2">
              Cada criterio se normaliza entre 0 y 100 mediante min–max dentro del conjunto visible. Si máximo y mínimo coinciden, todos reciben 100 en ese criterio. El puntaje del eje es el promedio simple de los criterios que sí tienen dato; un dato ausente se omite y nunca se convierte en cero.
            </p>
            <p className="mt-2 text-sm font-medium text-brand-ink">
              Cambiar el conjunto puede cambiar el puntaje de la misma variedad. No es un estándar absoluto ni una certificación comercial.
            </p>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden border-t-4 border-t-brand">
        <div className="border-b border-line p-4">
          <h2 className="font-semibold">Qué entra al ranking</h2>
          <p className="mt-1 text-sm text-ink-3">
            Los 7 descriptores del catálogo que entran al ranking. Qué dirección es mejor (mayor o menor) está fijado de antemano para cada uno. La Relación °Brix/Acidez también entra al ranking de Calidad, pero es un criterio <strong>derivado</strong> — no está en esta tabla porque no es un descriptor del catálogo (ver la nota debajo).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-ink-3"><th className="px-4 py-2 font-medium">Criterio</th><th className="px-4 py-2 font-medium">Eje</th><th className="px-4 py-2 font-medium">Dirección</th></tr></thead>
            <tbody>
              {CRITERIOS.map(([criterio, eje, direccion]) => (
                <tr key={criterio} className="border-b border-line-soft last:border-0"><th className="px-4 py-2 font-medium">{criterio}</th><td className="px-4 py-2">{eje}</td><td className="px-4 py-2 font-mono text-xs">{direccion}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 border-t-4 border-t-brand p-4">
          <div className="flex items-center gap-2"><CircleHelp className="h-5 w-5 text-brand" /><h2 className="font-semibold">Por qué Fenología y Adaptabilidad no puntúan</h2></div>
          <p className="text-sm text-ink-2">
            Sus estados describen comportamiento, pero no tienen una dirección universal de mérito. Por ejemplo, floración temprana puede ser favorable en un sitio y riesgosa en otro. Se muestran como perfiles de moda y se marca divergencia cuando las plantas del grupo no coinciden.
          </p>
        </Card>

        <Card className="space-y-3 border-t-4 border-t-brand p-4">
          <div className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-brand" /><h2 className="font-semibold">Por qué Acidez no rankea aislada</h2></div>
          <p className="text-sm text-ink-2">
            La acidez por sí sola no representa mejor calidad: su lectura depende del equilibrio con los sólidos solubles. Para evitar premiar artificialmente un extremo, se excluye como criterio aislado y solo participa en la relación derivada °Brix/Acidez cuando ambos valores existen.
          </p>
        </Card>
      </div>

      <Card className="space-y-3 border border-warn/30 bg-warn-l p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          <div>
            <h2 className="font-semibold text-warn">Relación °Brix/Acidez: criterio derivado, no un descriptor más</h2>
            <p className="mt-1 text-sm text-ink-2">
              A diferencia de los 7 criterios de la tabla de arriba, la Relación °Brix/Acidez <strong>no es un descriptor del catálogo</strong>. Se calcula automáticamente a partir de Dulzor (°Brix) y Acidez, solo cuando ambos valores existen para el grupo comparado — no es algo que se capture directamente en el formulario.
            </p>
            <p className="mt-2 text-sm text-ink-2">
              El cálculo toma 18 como valor de referencia: cuanto más cerca de 18 queda el ratio, mayor es el valor normalizado. La asociación orientativa de un ratio menor a 18 con mejor vida útil proviene de una guía técnica comercial de cadena de frío, no de un ente normativo oficial como USDA, INTA u otro regulador.
            </p>
            <p className="mt-2 text-sm font-medium text-warn">Es una referencia técnica revisable, no una norma vinculante ni un umbral regulatorio.</p>
          </div>
        </div>
      </Card>

      <Card className="space-y-2 p-4 text-sm text-ink-2">
        <h2 className="font-semibold text-ink">Otras exclusiones y cautelas</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>El porcentaje de frutos por calibre es texto libre y no entra al ranking.</li>
          <li>Menos de 3 plantas con dato se marca como evidencia débil; el valor se muestra, pero no debe leerse con la misma confianza que un grupo más observado.</li>
          <li>Entre grupos conserva cada combinación variedad × ensayo: no promedia sitios distintos.</li>
          <li>La divergencia no es error estadístico; es una señal explícita de uniformidad varietal.</li>
        </ul>
      </Card>
    </div>
  );
}
