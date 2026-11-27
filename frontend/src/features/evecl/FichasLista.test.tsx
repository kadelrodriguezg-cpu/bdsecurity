import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { EveclFichaLista } from '@/api/evecl';
import { FichasLista } from './FichasLista';

afterEach(cleanup);

const FICHAS: EveclFichaLista[] = [
  { id: 1, ensayo_id: 4, variedad: 'Legacy', tipo: 'evaluacion', numero_repeticion: 1, codigo_planta: null, fecha_evaluacion: '2026-08-11', respondidos: 8, total_descriptores: 27 },
  { id: 2, ensayo_id: 4, variedad: 'Duke', tipo: 'testigo', numero_repeticion: 2, codigo_planta: 'D-02', fecha_evaluacion: '2026-08-11', respondidos: 27, total_descriptores: 27 },
];

describe('FichasLista', () => {
  it('agrupa y filtra con lower(trim), conservando las tres fichas del mismo nombre', () => {
    const fichas = [FICHAS[0], FICHAS[1], { ...FICHAS[1], id: 3, variedad: ' duke ', numero_repeticion: 3 },
      { ...FICHAS[1], id: 4, variedad: 'DUKE', numero_repeticion: 4 }];
    render(<MemoryRouter><FichasLista fichas={fichas} codigoParcela="P-01" /></MemoryRouter>);
    expect(screen.getAllByRole('heading')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^duke$/i })).toHaveLength(1);
    expect(screen.getByText('3 plantas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Duke' }));
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: 'Legacy' })).not.toBeInTheDocument();
  });

  it('muestra ausencia como raya, completitud y permite filtrar por variedad', () => {
    render(<MemoryRouter><FichasLista fichas={FICHAS} codigoParcela="P-01" /></MemoryRouter>);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByLabelText('8 de 27 descriptores respondidos')).toBeInTheDocument();
    expect(screen.getByText('Testigo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Duke' }));
    expect(screen.queryByRole('heading', { name: 'Legacy' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Duke' })).toBeInTheDocument();
  });
});
