// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi } from 'vitest'
import { csvCell, toCsv, slug, downloadCsv } from './csv'

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

  it('downloads the CSV as a UTF-8 file with the given name, then cleans up', async () => {
    vi.useFakeTimers()
    const created = vi.fn(() => 'blob:report')
    const revoked = vi.fn()
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCsv('season.csv', 'a,b\r\n1,2')

    const blob = created.mock.calls[0][0]
    expect(blob.type).toBe('text/csv;charset=utf-8')
    // Read raw bytes: blob.text() silently drops a leading byte-order mark.
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('a,b\r\n1,2')
    const link = click.mock.contexts[0]
    expect(link.download).toBe('season.csv')
    expect(link.getAttribute('href')).toBe('blob:report')
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(revoked).toHaveBeenCalledWith('blob:report')
    click.mockRestore()
    vi.useRealTimers()
  })
})
