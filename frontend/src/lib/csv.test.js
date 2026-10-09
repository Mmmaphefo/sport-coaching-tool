// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect } from 'vitest'
import { csvCell, toCsv, slug } from './csv'

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('Smith, J')).toBe('"Smith, J"')
    expect(csvCell('The "Rovers"')).toBe('"The ""Rovers"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })
  it('neutralises spreadsheet formulas but keeps numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell('-3')).toBe('-3')
  })
  it('renders empty values as blank cells', () => {
    expect(toCsv(['a', 'b'], [[null, undefined], [1, 'x']])).toBe('a,b\r\n,\r\n1,x')
  })
  it('makes file-name slugs', () => {
    expect(slug('Wits FC  U19!')).toBe('wits-fc-u19')
    expect(slug('')).toBe('report')
  })
})
