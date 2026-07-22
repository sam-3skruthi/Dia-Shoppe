/*
  Tiny CSV export helper — builds a spreadsheet-safe CSV string and triggers a
  browser download. Values with commas/quotes/newlines are escaped; a UTF-8 BOM
  is prepended so Excel opens ₹ and other characters correctly.

  columns: [{ label, value }] where value is (row) => cell, or a plain key.
*/
function escapeCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCell(c.label)).join(',')
  const body = rows
    .map((r) => columns.map((c) => escapeCell(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','))
    .join('\n')
  return `${header}\n${body}`
}

export function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Convenience: build the CSV and download it in one call. */
export function exportCsv(filename, rows, columns) {
  downloadCsv(filename, toCsv(rows, columns))
}
