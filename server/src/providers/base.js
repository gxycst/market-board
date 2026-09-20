export class QuoteProvider {
  constructor(name) { this.name = name }
  async fetchQuotes() { throw new Error('fetchQuotes must be implemented') }
}

export function withCommonFields(instrument, values) {
  return {
    id: instrument.id,
    name: instrument.name,
    displayCode: instrument.displayCode,
    assetType: instrument.assetType,
    marketGroup: instrument.marketGroup || null,
    custom: Boolean(instrument.custom),
    price: null,
    change: null,
    changePercent: null,
    iopv: null,
    premiumRate: null,
    previousYearClose: null,
    ytdChangePercent: null,
    oneYearAgoClose: null,
    oneYearChangePercent: null,
    currency: null,
    marketTime: null,
    provider: null,
    status: 'unavailable',
    ...values
  }
}
