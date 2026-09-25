import { renderEmailShell, EMAIL_COLORS, fmtGHS, mono } from './theme';

describe('renderEmailShell', () => {
  it('uses the primary theme color for the "primary" accent', () => {
    const html = renderEmailShell({
      accent: 'primary',
      organisationName: 'Test Welfare Union',
      eyebrow: 'Test Notice',
      bodyHtml: '<p>Hello world</p>',
    });

    expect(html).toContain(EMAIL_COLORS.primary);
    expect(html).toContain('Test Welfare Union');
    expect(html).toContain('Test Notice');
    expect(html).toContain('<p>Hello world</p>');
  });

  it('switches header color per accent and never mixes accents', () => {
    const warning = renderEmailShell({
      accent: 'warning',
      organisationName: 'Org',
      eyebrow: 'Warning Notice',
      bodyHtml: '<p>x</p>',
    });
    const danger = renderEmailShell({
      accent: 'danger',
      organisationName: 'Org',
      eyebrow: 'Danger Notice',
      bodyHtml: '<p>x</p>',
    });

    expect(warning).toContain(EMAIL_COLORS.warning);
    expect(warning).not.toContain(EMAIL_COLORS.danger);
    expect(danger).toContain(EMAIL_COLORS.danger);
    expect(danger).not.toContain(EMAIL_COLORS.warning);
  });

  it('includes an optional footer note when provided', () => {
    const html = renderEmailShell({
      accent: 'info',
      organisationName: 'Org',
      eyebrow: 'Info Notice',
      bodyHtml: '<p>x</p>',
      footerNote: 'Automated notice',
    });

    expect(html).toContain('Automated notice');
  });
});

describe('fmtGHS', () => {
  it('formats to two decimal places with the GHS prefix', () => {
    expect(fmtGHS(1234.5)).toBe('GHS 1,234.50');
  });
});

describe('mono', () => {
  it('wraps the value in the monospace font span', () => {
    expect(mono('ABC123')).toContain('ABC123');
    expect(mono('ABC123')).toContain("'JetBrains Mono'");
  });
});
