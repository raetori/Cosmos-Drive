import { describe, expect, it } from 'vitest'
import { NameAllocator, exportFor, formatBytes, parseDriveLink, parseResourceKey, sanitizeName, withExtension } from '../src/lib/paths'

describe('sanitizeName', () => {
  it('replaces characters that are illegal on Windows or macOS', () => {
    expect(sanitizeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })
  it('handles reserved and empty names', () => {
    expect(sanitizeName('CON')).toBe('_CON')
    expect(sanitizeName('nul.txt')).toBe('_nul.txt')
    expect(sanitizeName('...')).toBe('_')
    expect(sanitizeName('trailing. ')).toBe('trailing')
  })
  it('caps long names but keeps the extension', () => {
    const out = sanitizeName('x'.repeat(300) + '.mov')
    expect(out.length).toBe(200)
    expect(out.endsWith('.mov')).toBe(true)
  })
})

describe('NameAllocator', () => {
  it('numbers duplicates per folder, case-insensitively', () => {
    const a = new NameAllocator()
    expect(a.claim('', 'Invoice.pdf')).toBe('Invoice.pdf')
    expect(a.claim('', 'invoice.pdf')).toBe('invoice (2).pdf')
    expect(a.claim('', 'Invoice.pdf')).toBe('Invoice (3).pdf')
    expect(a.claim('sub', 'Invoice.pdf')).toBe('Invoice.pdf')
  })
})

describe('parseDriveLink', () => {
  it('reads the common link shapes', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
    expect(parseDriveLink(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBe(id)
    expect(parseDriveLink(`https://drive.google.com/drive/u/1/folders/${id}`)).toBe(id)
    expect(parseDriveLink(`https://drive.google.com/file/d/${id}/view`)).toBe(id)
    expect(parseDriveLink(`https://drive.google.com/open?id=${id}`)).toBe(id)
    expect(parseDriveLink(id)).toBe(id)
    expect(parseDriveLink('not a link')).toBeNull()
  })
  it('keeps the resource key of older shared links', () => {
    expect(parseResourceKey('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?resourcekey=0-AbC_d-123&usp=sharing')).toBe('0-AbC_d-123')
    expect(parseResourceKey('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz')).toBeUndefined()
  })
})

describe('exports and formatting', () => {
  it('maps Google types to Office or PDF', () => {
    expect(exportFor('application/vnd.google-apps.document', 'office')?.ext).toBe('.docx')
    expect(exportFor('application/vnd.google-apps.spreadsheet', 'pdf')?.ext).toBe('.pdf')
    expect(exportFor('application/vnd.google-apps.form', 'office')).toBeNull()
    expect(withExtension('Budget', '.xlsx')).toBe('Budget.xlsx')
    expect(withExtension('Budget.XLSX', '.xlsx')).toBe('Budget.XLSX')
  })
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
  })
})
