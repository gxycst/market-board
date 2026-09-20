const ENDPOINT = 'https://qt.gtimg.cn/q='

function finite(value) {
  if (value == null || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export class TencentPremiumProvider {
  async fetchPremium(instruments) {
    if (!instruments.length) return new Map()

    const response = await fetch(`${ENDPOINT}${instruments.map(item => item.providerSymbol).join(',')}`, {
      headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4500)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const text = new TextDecoder('gb18030').decode(await response.arrayBuffer())
    const bySymbol = new Map()
    for (const line of text.split(/;\s*/)) {
      const match = line.match(/^v_([^=]+)="(.*)"$/)
      if (!match) continue
      const fields = match[2].split('~')
      const premiumRate = finite(fields[77])
      if (premiumRate == null) continue
      bySymbol.set(match[1], {
        premiumRate,
        // ETF 通常在 78 返回盘中 IOPV；LOF 可能只在 81 返回参考净值。
        iopv: finite(fields[78]) ?? finite(fields[81]),
        // 行情源直接发布的近一年涨幅，口径与新浪财经 App 显示一致。
        oneYearChangePercent: finite(fields[79]),
        premiumProvider: 'tencent'
      })
    }

    return new Map(instruments.map(item => [item.id, bySymbol.get(item.providerSymbol)]).filter(([, value]) => value))
  }
}
