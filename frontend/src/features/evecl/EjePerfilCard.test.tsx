import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { EveclPerfilItem } from '@/api/evecl';
import { EjePerfilCard } from './EjePerfilCard';

afterEach(cleanup);

const ITEMS: EveclPerfilItem[] = [
  { grupo_key: 'duke', grupo_label: 'Duke — P-01', descriptor: 'Época de floración', nota_moda: 5, label_moda: 'Media', divergente: true, n_con_dato: 4, n_total: 5 },
];

describe('EjePerfilCard', () => {
  it('muestra moda, ausencia como raya y divergencia visible', () => {
    render(<EjePerfilCard titulo="Fenología" descripcion="Perfil" items={ITEMS} descriptores={['Época de floración', 'Época de madurez']} />);
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getByText('UPOV 5')).toHaveClass('font-mono');
    expect(screen.getByText('Divergencia')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText(/las plantas no coinciden/)).toBeInTheDocument();
  });
});
