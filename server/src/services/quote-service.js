import { instruments } from '../config/instruments.js'
import { SinaProvider } from '../providers/sina.js'
import { YahooProvider } from '../providers/yahoo.js'
import { TencentPremiumProvider } from '../providers/tencent-premium.js'
import { withCommonFields } from '../providers/base.js'
import { getYtdChanges } from './ytd-service.js'

const providers = { sina: new SinaProvider(), yahoo: new YahooProvider() }
const premiumProvider = new TencentPremiumProvider()
const cache = new Map()
const pending = new Map()

function customCnInstruments(symbols = []) {
  const fixedSymbols = new Set(instruments.map(item => item.providerSymbol))
  return [...new Set(symbols)]
    .filter(symbol => /^(sh|sz|bj)\d{6}$/.test(symbol))
    .filter(symbol => !fixedSymbols.has(symbol))
    .slice(0, 30)
    .map(symbol => ({
      id: `custom-${symbol}`,
      name: '加载中',
      displayCode: `${symbol.slice(2)}.${symbol.slice(0, 2).toUpperCase()}`,
      assetType: 'stock-cn',
      provider: 'sina',
      providerSymbol: symbol,
      parser: 'sinaCnStock',
      custom: true
    }))
}

async function refresh(customSymbols) {
  const requested = [...instruments, ...customCnInstruments(customSymbols)]
  const grouped = requested.reduce((result, item) => {
    ;(result[item.provider] ||= []).push(item)
    return result
  }, {})
  const settled = await Promise.allSettled(Object.entries(grouped).map(async ([name, items]) => providers[name].fetchQuotes(items)))
  const byId = new Map()
  const errors = []
  settled.forEach((result, index) => {
    const providerName = Object.keys(grouped)[index]
    if (result.status === 'fulfilled') result.value.forEach(quote => byId.set(quote.id, quote))
    else errors.push(`${providerName}: ${result.reason?.message || 'unknown error'}`)
  })
  const data = requested.map(item => byId.get(item.id) || withCommonFields(item, { provider: item.provider }))
  const premiumInstruments = requested.filter(item =>
    ['美国', '日本'].includes(item.marketGroup) && /^(sh|sz)\d{6}$/.test(item.providerSymbol)
  )
  const ytdChanges = await getYtdChanges(premiumInstruments, data)
  data.forEach(quote => Object.assign(quote, ytdChanges.get(quote.id) || {}))
  try {
    const premiums = await premiumProvider.fetchPremium(premiumInstruments)
    data.forEach(quote => Object.assign(quote, premiums.get(quote.id) || {}))
  } catch (error) {
    errors.push(`溢价率/近一年: ${error?.message || 'unknown error'}`)
  }
  for (const quote of data) {
    if (quote.error) errors.push(`${quote.name}: ${quote.error}`)
  }
  return { data, errors, serverTime: new Date().toISOString(), refreshIntervalMs: 1000 }
}

export async function getQuotes(customSymbols = []) {
  const key = [...new Set(customSymbols)].sort().join(',')
  const cached = cache.get(key)
  if (cached && Date.now() - cached.time < 750) return { ...cached.value, cached: true }
  if (!pending.has(key)) {
    pending.set(key, refresh(customSymbols)
      .then(value => { cache.set(key, { value, time: Date.now() }); return value })
      .finally(() => pending.delete(key)))
  }
  return pending.get(key)
}
