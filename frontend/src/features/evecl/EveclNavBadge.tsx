/** Etiqueta contextual EVECL para diferenciar material externo del pipeline genético. */
export function EveclNavBadge() {
  return (
    <span className="flex items-center gap-1.5">
      <span>EVECL</span>
      <span className="rounded-full bg-brand-l px-1.5 py-0.5 text-[10px] font-semibold text-brand-ink">
        Externo
      </span>
    </span>
  );
}
