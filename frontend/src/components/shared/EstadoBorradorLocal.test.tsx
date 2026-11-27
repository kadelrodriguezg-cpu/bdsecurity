import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EstadoBorradorLocal } from './EstadoBorradorLocal';
import { useBorradorLocal } from '@/lib/useBorradorLocal';
const inicial = { nota: '' };
function Arnes() {
  const borrador = useBorradorLocal('borrador:aviso', inicial);
  return <><input aria-label="Nota" value={borrador.valor.nota} onChange={(e) => borrador.setValor({ nota: e.target.value })} /><EstadoBorradorLocal {...borrador} textoIdle="Los campos incompletos se pueden guardar." compacto={false} /></>;
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });
it('solo anuncia guardado después de persistir; fallo posterior conserva memoria y reemplaza éxito por alerta', () => {
  render(<Arnes />);
  expect(screen.getByRole('status')).toHaveTextContent('Los campos incompletos se pueden guardar.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(localStorage.length).toBe(0);
  fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Primera nota' } });
  expect(screen.getByRole('status')).toHaveTextContent('Guardando borrador local…');
  expect(localStorage.getItem('borrador:aviso')).toBeNull();
  act(() => vi.advanceTimersByTime(1500));
  expect(JSON.parse(localStorage.getItem('borrador:aviso')!).valor.nota).toBe('Primera nota');
  expect(screen.getByRole('status')).toHaveTextContent('Borrador local guardado');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Segunda nota' } });
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Nota')).toHaveValue('Segunda nota');
  expect(JSON.parse(localStorage.getItem('borrador:aviso')!).valor.nota).toBe('Primera nota');
});
