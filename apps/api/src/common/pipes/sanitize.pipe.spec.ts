import { SanitizePipe } from './sanitize.pipe';

describe('SanitizePipe', () => {
  let pipe: SanitizePipe;
  beforeEach(() => { pipe = new SanitizePipe(); });

  it('trims whitespace from strings', () => {
    expect(pipe.transform({ name: '  Alice  ' }, { type: 'body' } as any)).toEqual({ name: 'Alice' });
  });

  it('strips HTML tags from strings', () => {
    // Tag delimiters removed; text content between tags is preserved (not a risk in JSON API responses)
    expect(pipe.transform({ note: '<b>Hello</b>' }, { type: 'body' } as any)).toEqual({ note: 'Hello' });
    expect(pipe.transform({ note: '<script>alert(1)</script>Safe' }, { type: 'body' } as any)).toEqual({ note: 'alert(1)Safe' });
  });

  it('recursively sanitizes nested objects', () => {
    const input = { a: { b: '  <b>hi</b>  ' } };
    expect(pipe.transform(input, { type: 'body' } as any)).toEqual({ a: { b: 'hi' } });
  });

  it('sanitizes strings inside arrays', () => {
    expect(pipe.transform({ tags: [' <em>x</em> ', ' y '] }, { type: 'body' } as any)).toEqual({ tags: ['x', 'y'] });
  });

  it('leaves numbers and booleans unchanged', () => {
    expect(pipe.transform({ n: 42, flag: true }, { type: 'body' } as any)).toEqual({ n: 42, flag: true });
  });

  it('leaves non-body metadata (e.g. params) unchanged', () => {
    expect(pipe.transform('  raw  ', { type: 'param', data: 'id' } as any)).toBe('  raw  ');
  });
});
