import { QuoteProvider, withCommonFields } from './base.js'

export class YahooProvider extends QuoteProvider {
  constructor() { super('yahoo') }

  async fetchQuotes(instruments) {
    return Promise.all(instruments.map(async instrument => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4500)
      try {
        const symbol = encodeURIComponent(instrument.providerSymbol)
        let response
        for (let attempt = 0; attempt < 2; attempt += 1) {
          response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 MarketBoard/0.1' }
          })
          if (response.ok || attempt === 1) break
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const result = (await response.json()).chart?.result?.[0]
        const meta = result?.meta || {}
        const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : null
        const previousClose = Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : null
        const change = price != null && previousClose != null ? price - previousClose : null
        return withCommonFields(instrument, {
          price,
          change,
          changePercent: change != null && previousClose ? change / previousClose * 100 : null,
          currency: meta.currency || 'KRW',
          marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
          provider: 'yahoo',
          status: price == null ? 'unavailable' : 'ok'
        })
      } catch (error) {
        return withCommonFields(instrument, { provider: 'yahoo', error: error.message })
      } finally { clearTimeout(timeout) }
    }))
  }
}
