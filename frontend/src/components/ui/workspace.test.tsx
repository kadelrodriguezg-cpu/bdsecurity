import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { Workspace } from './workspace';

afterEach(cleanup);

it('U-10: el marco redondea recortando (overflow-clip), no con overflow-hidden, para no romper el sticky de lo que contiene', () => {
  const { container } = render(<Workspace>contenido</Workspace>);
  expect(container.firstElementChild).toHaveClass('overflow-clip');
  expect(container.firstElementChild).not.toHaveClass('overflow-hidden');
});
