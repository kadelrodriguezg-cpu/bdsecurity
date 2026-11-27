import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { anchoAmplio, DESTINOS, destinosPara, seccionesDe } from './destinos';
import { SeccionLayout } from './SeccionLayout';
import { abreTeclado } from './useTecladoAbierto';
import { lecturaDeTexto } from '@/lib/busquedaCodigo';

afterEach(cleanup);

describe('destinos', () => {
  it('el operario no recibe Administración', () => {
    expect(destinosPara(false).map((d) => d.id)).toEqual(['inicio', 'cruces', 'resultados']);
    expect(destinosPara(true).map((d) => d.id)).toEqual(['inicio', 'cruces', 'resultados', 'administracion']);
  });

  it('v3 paso 7: Resultados es una sola tabla, sin secciones; las rutas viejas siguen activando Resultados (redirigen)', () => {
    expect(seccionesDe('resultados')).toEqual([]);
    const resultados = DESTINOS.find((d) => d.id === 'resultados')!;
    for (const ruta of ['/resultados', '/resultados/mapa', '/ranking', '/dashboard', '/visualizaciones']) expect(resultados.activo(ruta), ruta).toBe(true);
  });

  it('Administración empieza por Administrar cruces (N11) y reúne Usuarios y Catálogos; el importador sigue oculto', () => {
    expect(seccionesDe('administracion').map((s) => s.to)).toEqual(['/cruzamientos', '/usuarios', '/catalogos']);
  });

  it('v3 paso 6: /nueva-especie (ahora Catálogos → Especies) pertenece a Administración y no a Cruces', () => {
    const activo = (id: string, ruta: string) => DESTINOS.find((d) => d.id === id)!.activo(ruta);
    expect(activo('administracion', '/nueva-especie')).toBe(true);
    expect(activo('cruces', '/nueva-especie')).toBe(false);
    expect(activo('cruces', '/nueva-planta')).toBe(true);
  });

  it('el ancho de contenido de cada ruta se conserva como antes del shell', () => {
    for (const ruta of ['/resultados', '/resultados/polinizacion', '/resultados/mapa', '/resultados/tendencias', '/plantas', '/usuarios', '/catalogos', '/cruzamientos', '/evecl', '/evecl/comparar', '/planta/abc/evaluacion/xyz']) {
      expect(anchoAmplio(ruta)).toBe(true);
    }
    for (const ruta of ['/', '/perfil', '/escanear', '/planta/abc', '/evecl/referencia']) {
      expect(anchoAmplio(ruta)).toBe(false);
    }
  });
});

describe('SeccionLayout', () => {
  function montar(ruta: string, destino: 'resultados' | 'administracion') {
    return render(
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route element={<SeccionLayout destino={destino} />}>
            <Route path="*" element={<p>Pantalla</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it('lista las secciones, marca la actual con aria-current y deja ver la pantalla', () => {
    montar('/usuarios', 'administracion');
    const barra = screen.getByRole('navigation', { name: 'Secciones' });
    expect(within(barra).getAllByRole('link').map((e) => e.textContent)).toEqual(['Administrar cruces', 'Usuarios', 'Catálogos']);
    expect(within(barra).getByRole('link', { name: 'Usuarios' })).toHaveAttribute('aria-current', 'page');
    expect(within(barra).getByRole('link', { name: 'Catálogos' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Pantalla')).toBeInTheDocument();
  });

  it('en Administración marca la sección de la ruta', () => {
    montar('/catalogos', 'administracion');
    expect(screen.getByRole('link', { name: 'Catálogos' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('ayudas de la búsqueda y del teclado', () => {
  it('distingue el código de un individuo del de un cruce', () => {
    expect(lecturaDeTexto('02-502-P1')).toEqual({ tipo: 'codigo_individuo', valor: '02-502-P1' });
    expect(lecturaDeTexto(' 02-502 ')).toEqual({ tipo: 'codigo_sistema', valor: '02-502' });
  });

  it('solo los campos de texto abren el teclado', () => {
    const texto = document.createElement('input');
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    const area = document.createElement('textarea');
    const boton = document.createElement('button');
    expect(abreTeclado(texto)).toBe(true);
    expect(abreTeclado(area)).toBe(true);
    expect(abreTeclado(casilla)).toBe(false);
    expect(abreTeclado(boton)).toBe(false);
    expect(abreTeclado(null)).toBe(false);
  });
});
