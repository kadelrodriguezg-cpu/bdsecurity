import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useManualTabs } from './useManualTabs';

afterEach(cleanup);
function Ejemplo({ onSelect = () => {} }: { onSelect?: (id: string) => void }) {
  const [selected, setSelected] = useState('uno');
  const tabs = useManualTabs(['uno', 'dos', 'tres'], selected, (id) => { onSelect(id); setSelected(id); });
  return <section><div role="tablist" aria-label="Ejemplo">{['uno', 'dos', 'tres'].map((id) => <button key={id} {...tabs.tabProps(id)}>{id}</button>)}</div><div {...tabs.panelProps(selected)}>{selected} contenido</div>{['uno', 'dos', 'tres'].filter((id) => id !== selected).map((id) => <div key={id} {...tabs.panelProps(id)} hidden />)}</section>;
}
describe('Tabs manuales', () => {
  it('flechas y Home/End cambian foco, sin activar contenido ni efectos de selección', () => {
    const onSelect = vi.fn();
    render(<Ejemplo onSelect={onSelect} />);
    const uno = screen.getByRole('tab', { name: 'uno' });
    const dos = screen.getByRole('tab', { name: 'dos' });
    const tres = screen.getByRole('tab', { name: 'tres' });
    fireEvent.keyDown(uno, { key: 'ArrowRight' });
    expect(dos).toHaveFocus();
    expect(uno).toHaveAttribute('aria-selected', 'true');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(dos, { key: 'End' });
    expect(tres).toHaveFocus();
    fireEvent.keyDown(tres, { key: 'ArrowRight' });
    expect(uno).toHaveFocus();
    fireEvent.keyDown(uno, { key: 'ArrowLeft' });
    expect(tres).toHaveFocus();
    fireEvent.keyDown(tres, { key: 'Home' });
    expect(uno).toHaveFocus();
    fireEvent.click(dos);
    expect(onSelect).toHaveBeenCalledWith('dos');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', dos.id);
    expect(dos.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id);
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });
  it('no duplica IDs entre instancias y conserva panel enfocable', () => {
    render(<><Ejemplo /><Ejemplo /></>);
    const tabs = screen.getAllByRole('tab');
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(6);
    for (const tab of tabs) expect(document.getElementById(tab.getAttribute('aria-controls')!)).not.toBeNull();
    for (const lista of screen.getAllByRole('tablist')) expect(within(lista).getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    for (const panel of screen.getAllByRole('tabpanel')) expect(panel.tabIndex).toBe(0);
  });
});
