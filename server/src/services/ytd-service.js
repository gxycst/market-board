const cache = new Map()
const CACHE_MS = 30 * 60 * 1000

async function fetchPerformanceBases(symbol) {
  const cached = cache.get(symbol)
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.value

  const response = await fetch(`https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=300`, {
    headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' },
    signal: AbortSignal.timeout(5000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('invalid history response')
  const rows = JSON.parse(text.slice(start, end + 1))
  const yearStart = `${new Date().getFullYear()}-01-01`
  const previous = rows.filter(row => row.day < yearStart && Number.isFinite(Number(row.close))).at(-1)
  const value = {
    previousYearClose: previous ? Number(previous.close) : null
  }
  cache.set(symbol, { time: Date.now(), value })
  return value
}

export async function getYtdChanges(instruments, quotes) {
  const quoteById = new Map(quotes.map(item => [item.id, item]))
  const entries = await Promise.all(instruments.map(async instrument => {
    try {
      const { previousYearClose } = await fetchPerformanceBases(instrument.providerSymbol)
      const price = quoteById.get(instrument.id)?.price
      const ytdChangePercent = Number.isFinite(price) && previousYearClose
        ? (price - previousYearClose) / previousYearClose * 100
        : null
      return [instrument.id, { previousYearClose, ytdChangePercent }]
    } catch {
      return [instrument.id, { previousYearClose: null, ytdChangePercent: null }]
    }
  }))
  return new Map(entries)
}
