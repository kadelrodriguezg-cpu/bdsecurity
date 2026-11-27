/** Fase 5 (G18): paginación numerada compartida, con la página en la URL. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { usePaginacionUrl } from '@/lib/usePaginacionUrl';
import { Paginacion } from './Paginacion';

afterEach(cleanup);

const filas = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

function Tabla({ cantidad = 378 }: { cantidad?: number }) {
  const [filtro, setFiltro] = useState('');
  const items = filas(cantidad).filter((f) => f.includes(filtro));
  const p = usePaginacionUrl(items, { reinicio: [filtro] });
  const ubicacion = useLocation();
  return (
    <>
      <input aria-label="Buscar" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      <ul aria-label="Filas">{p.pagina.map((f) => <li key={f}>{f}</li>)}</ul>
      <Paginacion estado={p} />
      <output data-testid="url">{ubicacion.search}</output>
    </>
  );
}

const montar = (url = '/', cantidad?: number) => render(<MemoryRouter initialEntries={[url]}><Tabla cantidad={cantidad} /></MemoryRouter>);
const filasVisibles = () => within(screen.getByRole('list', { name: 'Filas' })).getAllByRole('listitem').map((li) => li.textContent);

describe('Paginacion', () => {
  it('muestra «Mostrando 1–50 de 378», los números con puntos suspensivos y la primera página', () => {
    montar();
    expect(screen.getByText('Mostrando 1–50 de 378')).toBeInTheDocument();
    expect(filasVisibles()).toHaveLength(50);
    expect(filasVisibles()[0]).toBe('P1');
    expect(screen.getByRole('button', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Página 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Página 4' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Página 8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled();
  });

  it('ir a una página la guarda en la URL y cambia las filas', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Página 3' }));
    expect(screen.getByTestId('url')).toHaveTextContent('pag=3');
    expect(screen.getByText('Mostrando 101–150 de 378')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByTestId('url')).toHaveTextContent('pag=4');
    expect(filasVisibles()[0]).toBe('P151');
  });

  it('la página de la URL se respeta al montar (y se acota si sobra)', () => {
    montar('/?pag=6');
    expect(screen.getByText('Mostrando 251–300 de 378')).toBeInTheDocument();
    cleanup();
    montar('/?pag=40');
    expect(screen.getByText('Mostrando 351–378 de 378')).toBeInTheDocument();
  });

  it('100 filas por página: queda en la URL y vuelve a la página 1', () => {
    montar('/?pag=3');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '100' } });
    expect(screen.getByTestId('url')).toHaveTextContent('filas=100');
    expect(screen.getByTestId('url')).not.toHaveTextContent('pag=');
    expect(screen.getByText('Mostrando 1–100 de 378')).toBeInTheDocument();
  });

  it('cambiar la búsqueda vuelve a la página 1; los conteos son sobre el total filtrado', () => {
    montar('/?pag=4');
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: '7' } });
    expect(screen.getByTestId('url')).not.toHaveTextContent('pag=');
    expect(screen.getByText(/^Mostrando 1–50 de \d+$/)).toBeInTheDocument();
  });

  it('en el celular: «‹ Página 2 de 8 ›»', () => {
    montar('/?pag=2');
    expect(screen.getByText('Página 2 de 8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('Página 3 de 8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
    expect(screen.getByText('Página 2 de 8')).toBeInTheDocument();
  });

  it('con una sola página no hay números ni selector de filas', () => {
    montar('/', 30);
    expect(screen.getAllByText('Mostrando 1–30 de 30').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Página 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
