import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/ui/App';

/* Deliberately thin. The pure core is where every interesting bug in this
   project lives; rendering assertions mostly end up testing React. This exists
   to catch "the app does not boot at all", which is worth exactly one test. */
describe('App', () => {
  it('boots', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'roomarr' })).toBeTruthy();
  });
});
