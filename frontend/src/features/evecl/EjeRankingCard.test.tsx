import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { EveclRankingItem } from '@/api/evecl';
import { EjeRankingCard } from './EjeRankingCard';

afterEach(cleanup);

const ITEMS: EveclRankingItem[] = [
  { grupo_key: 'uno', grupo_label: 'Duke — P-01', variedad: 'Duke', ensayo_id: 1, tipo: 'evaluacion', puntaje: 73, n_con_dato: 1, n_total: 5 },
  { grupo_key: 'dos', grupo_label: 'Legacy — P-02', variedad: 'Legacy', ensayo_id: 2, tipo: 'evaluacion', puntaje: 54, n_con_dato: 4, n_total: 5 },
];

describe('EjeRankingCard', () => {
  it('marca inequívocamente evidencia débil y explica que el puntaje es relativo', () => {
    const { container } = render(<EjeRankingCard titulo="Calidad" descripcion="Descripción" items={ITEMS} />);
    expect(screen.getByText('n=1/5')).toHaveClass('text-warn');
    expect(container.querySelector('.evecl-barra-rayada')).toBeInTheDocument();
    expect(screen.getByText(/Evidencia débil: Duke — P-01/)).toBeInTheDocument();
    expect(screen.getByText(/no un estándar de mercado/)).toBeInTheDocument();
    expect(screen.getByText('73')).toHaveClass('font-mono');
  });
});
