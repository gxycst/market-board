import { instruments } from '../config/instruments.js'

const cache = new Map()
const CACHE_MS = 5 * 60 * 1000
const yahooTickerById = { 'nikkei-225': '^N225', topix: '^TOPX', 'sse-composite': '000001.SS', kospi: '^KS11' }

function jsonFromJsonp(text) {
  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart && (arrayStart < 0 || objectStart < arrayStart)) {
    return JSON.parse(text.slice(objectStart, objectEnd + 1))
  }
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(text.slice(arrayStart, arrayEnd + 1))
  throw new Error('invalid history response')
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

async function fetchCnSeries(symbol) {
  const text = await fetchText(`https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=5&ma=no&datalen=90`)
  return jsonFromJsonp(text).map(row => Number(row.close)).filter(Number.isFinite).slice(-90)
}

async function fetchGlobalFutureSeries(symbol) {
  const text = await fetchText(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_data=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=${symbol}`)
  const payload = jsonFromJsonp(text)
  return (payload.minLine_1d || []).map(row => Number(row[1])).filter(Number.isFinite).slice(-90)
}

async function fetchGlobalFutureDailySeries(symbol) {
  const text = await fetchText(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_data=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${symbol}`)
  const values = jsonFromJsonp(text).map(row => Number(row.close)).filter(Number.isFinite).slice(-90)
  if (values.length < 20 || new Set(values).size < 5) throw new Error('Sina daily history unavailable')
  return values
}

async function fetchTencentMinuteSeries(code) {
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`, {
    signal: AbortSignal.timeout(6000),
    headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  const rows = payload.data?.[code]?.data?.data || []
  return rows.map(row => Number(String(row).split(' ')[1])).filter(Number.isFinite).slice(-90)
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

async function fetchNaverDailySeries(symbol) {
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 180)
  const url = `https://api.finance.naver.com/siseJson.naver?symbol=${symbol}&requestType=1&startTime=${yyyymmdd(start)}&endTime=${yyyymmdd(end)}&timeframe=day`
  const text = await fetchText(url)
  const values = (text.match(/\["\d{8}"[^\]]*\]/g) || [])
    .map(row => {
      try { return Number(JSON.parse(row)[4]) } catch { return NaN }
    })
    .filter(Number.isFinite)
    .slice(-90)
  if (values.length < 5) throw new Error('Naver history unavailable')
  return values
}

async function fetchCoinGeckoSeries() {
  const response = await fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1&interval=hourly', {
    signal: AbortSignal.timeout(6000),
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const values = ((await response.json()).prices || [])
    .map(row => Number(row[1]))
    .filter(Number.isFinite)
    .slice(-90)
  return validateCryptoSeries(values, 'CoinGecko')
}

function validateCryptoSeries(values, source) {
  const clean = values.map(Number).filter(Number.isFinite).slice(-90)
  if (clean.length < 20 || new Set(clean).size < 5) throw new Error(`${source} history unavailable`)
  return clean
}

async function fetchOkxSeries() {
  const response = await fetch('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=5m&limit=90', {
    signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const rows = (await response.json()).data || []
  return validateCryptoSeries(rows.map(row => row[4]).reverse(), 'OKX')
}

async function fetchBinanceSeries() {
  const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=90', {
    signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return validateCryptoSeries((await response.json()).map(row => row[4]), 'Binance')
}

async function fetchHuobiSeries() {
  const response = await fetch('https://api.huobi.pro/market/history/kline?period=5min&size=90&symbol=btcusdt', {
    signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const rows = (await response.json()).data || []
  return validateCryptoSeries(rows.map(row => row.close).reverse(), 'Huobi')
}

async function fetchBitcoinSeries() {
  const providers = [
    () => fetchGlobalFutureDailySeries('BTC'),
    fetchOkxSeries,
    fetchBinanceSeries,
    fetchHuobiSeries,
    fetchCoinGeckoSeries
  ]
  for (const provider of providers) {
    try { return await provider() } catch { /* 尝试下一个真实行情源 */ }
  }
  throw new Error('Bitcoin history unavailable')
}

async function fetchYahooSeries(ticker) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=5m`, {
    signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const result = (await response.json()).chart?.result?.[0]
  return (result?.indicators?.quote?.[0]?.close || []).filter(Number.isFinite).slice(-90)
}

async function fetchSeries(instrument) {
  const cached = cache.get(instrument.id)
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.values
  const symbol = instrument.providerSymbol
  let values = []
  if (/^(sh|sz|bj)\d{6}$/.test(symbol)) values = await fetchCnSeries(symbol)
  else if (symbol.startsWith('hf_')) values = await fetchGlobalFutureSeries(symbol.slice(3))
  else if (symbol === 'fx_sbtcusd') {
    values = await fetchBitcoinSeries()
  } else if (symbol.startsWith('b_KS')) {
    try { values = await fetchNaverDailySeries(symbol.slice(4)) }
    catch { values = await fetchTencentMinuteSeries(`kr${symbol.slice(4)}`) }
  }
  else if (symbol.startsWith('hk')) values = await fetchTencentMinuteSeries(symbol)
  else if (yahooTickerById[instrument.id]) values = await fetchYahooSeries(yahooTickerById[instrument.id])
  cache.set(instrument.id, { time: Date.now(), values })
  return values
}

export async function getIntraday(customSymbols = []) {
  const targets = [...instruments]
  for (const symbol of [...new Set(customSymbols)].slice(0, 30)) {
    if (/^(sh|sz|bj)\d{6}$/.test(symbol)) targets.push({ id: `custom-${symbol}`, providerSymbol: symbol })
  }
  const entries = await Promise.all(targets.map(async instrument => {
    try { return [instrument.id, await fetchSeries(instrument)] }
    catch { return [instrument.id, []] }
  }))
  return Object.fromEntries(entries)
}
