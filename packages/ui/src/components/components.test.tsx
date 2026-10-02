import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Field, Input } from './field';
import { StatusMark } from './status';

describe('Field', () => {
  it('wires label, hint and error for assistive tech', () => {
    render(
      <Field label="Email" hint="Work email" error="Enter a valid email address.">
        {(ids) => <Input {...ids} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy.split(' ')[0]!)?.textContent).toBe(
      'Enter a valid email address.',
    );
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.');
  });
});

describe('Button', () => {
  it('keeps its label and is disabled while loading', () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.hasAttribute('disabled')).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('type')).toBe('button');
  });
});

describe('StatusMark', () => {
  it('encodes status by fill, not colour', () => {
    const { container } = render(
      <>
        <StatusMark fill="outline" />
        <StatusMark fill="half" />
        <StatusMark fill="solid" />
      </>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs[0]!.querySelector('circle')!.getAttribute('fill')).toBe('none');
    expect(svgs[1]!.querySelector('path')).not.toBeNull();
    expect(svgs[2]!.querySelector('circle')!.getAttribute('fill')).toBe('currentColor');
  });
});
