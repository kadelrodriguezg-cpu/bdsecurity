import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoPush } from '@/lib/push/dispositivo';
import { BotonNotificacionesPush, InterruptorSonidoApp } from './NotificacionesDispositivo';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderBoton(estado: EstadoPush | null, extra: Partial<Parameters<typeof BotonNotificacionesPush>[0]> = {}) {
  const onActivar = vi.fn();
  const onDesactivar = vi.fn();
  render(<BotonNotificacionesPush estado={estado} procesando={false} error={null} onActivar={onActivar} onDesactivar={onDesactivar} {...extra} />);
  return { onActivar, onDesactivar };
}

describe('botón «Activar notificaciones»: cada estado', () => {
  it('cargando', () => {
    renderBoton(null);
    expect(screen.getByText('Revisando este dispositivo…')).toBeInTheDocument();
  });

  it('no soportado: explica qué navegadores sirven y no ofrece botón', () => {
    renderBoton({ tipo: 'no_soportado' });
    expect(screen.getByText(/no permite notificaciones/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('iPhone sin instalar: instrucciones para agregar la app a la pantalla de inicio', () => {
    renderBoton({ tipo: 'iphone_sin_instalar' });
    expect(screen.getByText('Primero instala la app')).toBeInTheDocument();
    expect(screen.getByText('Agregar a pantalla de inicio')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('permiso no pedido: el botón activa (y avisa que la notificación no lleva el mensaje)', () => {
    const { onActivar } = renderBoton({ tipo: 'disponible' });
    expect(screen.getByText(/nunca el texto del mensaje/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activar notificaciones' }));
    expect(onActivar).toHaveBeenCalledOnce();
  });

  it('activado: lo dice y permite desactivar', () => {
    const { onDesactivar } = renderBoton({ tipo: 'activado' });
    expect(screen.getByText('Activadas en este dispositivo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    expect(onDesactivar).toHaveBeenCalledOnce();
  });

  it('bloqueado: explica cómo desbloquear y no ofrece volver a pedir el permiso', () => {
    renderBoton({ tipo: 'bloqueado' });
    expect(screen.getByText('Bloqueadas en este navegador')).toBeInTheDocument();
    expect(screen.getByText(/recarga la página/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('procesando deshabilita el botón y un error se muestra', () => {
    renderBoton({ tipo: 'disponible' }, { procesando: true, error: 'No se pudo activar las notificaciones. Intenta de nuevo.' });
    expect(screen.getByRole('button', { name: 'Activando…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo activar');
  });
});

describe('interruptor «Sonido en la app»', () => {
  it('está activado por defecto y guarda la elección', () => {
    render(<InterruptorSonidoApp />);
    const interruptor = screen.getByRole('switch', { name: /Sonido en la app/ });
    expect(interruptor).toBeChecked();
    fireEvent.click(interruptor);
    expect(interruptor).not.toBeChecked();
    expect(localStorage.getItem('bds.sonidoApp')).toBe('no');
  });
});
