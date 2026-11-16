/** Format timestamps and request an explicit CSV download. */

export async function exportRecords(rows: object[], filename: string) {
  if (!rows.length) return false
  const cols = [...new Set(rows.flatMap(row => Object.keys(row)))]
  const cell = (v: unknown) => {
    const value = String(v ?? '')
    return '"' + (/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""') + '"'
  }
  const lines = [cols.map(cell).join(',')]
  for (const row of rows) {
    lines.push(cols.map((column) => cell((row as Record<string, unknown>)[column])).join(','))
  }
  return exportText('\uFEFF' + lines.join('\r\n'),filename,'text/csv;charset=utf-8')
}

export function exportText(text:string,filename:string,type:string) {
  const url = URL.createObjectURL(
    new Blob([text], { type })
  )
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return true
}
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const logTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})
export const formatTime = (time: string) => timeFormat.format(new Date(time))
export const formatLogTime = (time: string) => logTimeFormat.format(new Date(time))
