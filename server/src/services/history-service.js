import { instruments } from '../config/instruments.js'

const tickerById = {
  'nasdaq-future': 'NQ=F',
  'sp500-future': 'ES=F',
  'nikkei-225': '^N225',
  topix: '^TOPX',
  'sse-composite': '000001.SS',
  'szse-component': '399001.SZ',
  chinext: '399006.SZ',
  samsung: '005930.KS',
  'sk-hynix': '000660.KS',
  'hynix-2x-csop': '7709.HK',
  kospi: '^KS11',
  'samsung-2x-csop': '7747.HK',
  'bitcoin-usd': 'BTC-USD',
  'brent-oil': 'BZ=F',
  'spot-gold': 'GC=F'
}

let cache = new Map()

function customTicker(symbol) {
  const code = symbol.slice(2)
  if (symbol.startsWith('sh')) return `${code}.SS`
  if (symbol.startsWith('sz')) return `${code}.SZ`
  return null
}

async function fetchSeries(ticker) {
  const cached = cache.get(ticker)
  if (cached && Date.now() - cached.time < 5 * 60 * 1000) return cached.values
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const encoded = encodeURIComponent(ticker)
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=5d&interval=5m`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const result = (await response.json()).chart?.result?.[0]
    const closes = result?.indicators?.quote?.[0]?.close || []
    const values = closes.filter(Number.isFinite).slice(-90)
    cache.set(ticker, { time: Date.now(), values })
    return values
  } finally { clearTimeout(timeout) }
}

export async function getIntraday(customSymbols = []) {
  const targets = instruments.map(item => ({ id: item.id, ticker: tickerById[item.id] || customTicker(item.providerSymbol) }))
  for (const symbol of [...new Set(customSymbols)].slice(0, 30)) {
    const ticker = customTicker(symbol)
    if (ticker) targets.push({ id: `custom-${symbol}`, ticker })
  }
  const entries = await Promise.all(targets.map(async target => {
    try { return [target.id, await fetchSeries(target.ticker)] }
    catch { return [target.id, []] }
  }))
  return Object.fromEntries(entries)
}
