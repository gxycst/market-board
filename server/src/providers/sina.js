import iconv from 'iconv-lite'
import { QuoteProvider, withCommonFields } from './base.js'

const ENDPOINT = 'https://hq.sinajs.cn/'

function numeric(value) {
  const result = Number.parseFloat(value)
  return Number.isFinite(result) ? result : null
}

function parseLineMap(text) {
  const map = new Map()
  for (const match of text.matchAll(/var hq_str_([^=]+)="([^"]*)";/g)) map.set(match[1], match[2].split(','))
  return map
}

function parseFuture(instrument, fields) {
  const price = numeric(fields[0])
  const previousClose = numeric(fields[7])
  const change = price != null && previousClose != null ? price - previousClose : null
  return withCommonFields(instrument, {
    price,
    change,
    changePercent: change != null && previousClose ? change / previousClose * 100 : null,
    marketTime: fields[12] && fields[6] ? `${fields[12]}T${fields[6]}` : null,
    provider: 'sina',
    status: price == null ? 'unavailable' : 'ok'
  })
}

function parseSimpleIndex(instrument, fields) {
  const price = numeric(fields[1])
  const change = numeric(fields[2])
  const changePercent = numeric(fields[3])
  return withCommonFields(instrument, { price, change, changePercent, provider: 'sina', status: price == null ? 'unavailable' : 'ok' })
}

export function parseCnStock(instrument, fields) {
  const reportedPrice = numeric(fields[3])
  const previousClose = numeric(fields[2])
  // Sina reports the current price as 0 for suspended exchange-traded products.
  // Keep their last valid close instead of turning that sentinel into a -100% move.
  const suspended = reportedPrice === 0 && previousClose != null && previousClose > 0
  const price = suspended ? previousClose : (reportedPrice != null && reportedPrice > 0 ? reportedPrice : null)
  const change = price != null && previousClose != null ? price - previousClose : null
  const resolvedName = instrument.custom ? (fields[0] || instrument.name) : instrument.name
  return withCommonFields({ ...instrument, name: resolvedName }, {
    price,
    change,
    changePercent: change != null && previousClose ? change / previousClose * 100 : null,
    marketTime: fields[30] && fields[31] ? `${fields[30]}T${fields[31]}` : null,
    provider: 'sina',
    status: suspended ? 'suspended' : (price == null ? 'unavailable' : 'ok')
  })
}

function parseHkStock(instrument, fields) {
  const price = numeric(fields[6])
  const previousClose = numeric(fields[3])
  const change = numeric(fields[7]) ?? (price != null && previousClose != null ? price - previousClose : null)
  const changePercent = numeric(fields[8])
  return withCommonFields(instrument, {
    price,
    change,
    changePercent,
    marketTime: fields[17] && fields[18] ? `${fields[17].replaceAll('/', '-')}T${fields[18]}` : null,
    provider: 'sina',
    status: price == null ? 'unavailable' : 'ok'
  })
}

function parseForex(instrument, fields) {
  const price = numeric(fields[1])
  const change = numeric(fields[12])
  const previousClose = price != null && change != null ? price - change : null
  return withCommonFields(instrument, {
    price,
    change,
    changePercent: change != null && previousClose ? change / previousClose * 100 : null,
    marketTime: fields[17] && fields[0] ? `${fields[17]}T${fields[0]}` : null,
    provider: 'sina',
    status: price == null ? 'unavailable' : 'ok'
  })
}

export class SinaProvider extends QuoteProvider {
  constructor() { super('sina') }

  async fetchQuotes(instruments) {
    if (!instruments.length) return []
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4500)
    try {
      const symbols = instruments.map(item => item.providerSymbol).join(',')
      const response = await fetch(`${ENDPOINT}?rn=${Date.now()}&list=${symbols}`, {
        signal: controller.signal,
        headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = iconv.decode(Buffer.from(await response.arrayBuffer()), 'gbk')
      const lineMap = parseLineMap(text)
      return instruments.map(instrument => {
        const fields = lineMap.get(instrument.providerSymbol)
        if (!fields?.length || !fields[0]) return withCommonFields(instrument, { provider: 'sina' })
        if (instrument.parser === 'sinaFuture') return parseFuture(instrument, fields)
        if (instrument.parser === 'sinaCnStock') return parseCnStock(instrument, fields)
        if (instrument.parser === 'sinaHkStock') return parseHkStock(instrument, fields)
        if (instrument.parser === 'sinaForex') return parseForex(instrument, fields)
        return parseSimpleIndex(instrument, fields)
      })
    } finally { clearTimeout(timeout) }
  }
}
