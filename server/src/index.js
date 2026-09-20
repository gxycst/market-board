import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getQuotes } from './services/quote-service.js'
import { getIntraday } from './services/history-service.js'

const app = express()
const port = Number(process.env.PORT) || 3001
app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))
app.get('/api/quotes', async (req, res) => {
  try {
    const symbols = String(req.query.symbols || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
    res.set('Cache-Control', 'no-store').json(await getQuotes(symbols))
  }
  catch (error) { res.status(502).json({ error: '行情源请求失败', detail: error.message }) }
})

app.get('/api/intraday', async (req, res) => {
  try {
    const symbols = String(req.query.symbols || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
    res.set('Cache-Control', 'private, max-age=300').json({ data: await getIntraday(symbols) })
  } catch (error) { res.status(502).json({ error: '分时数据请求失败', detail: error.message }) }
})

function calculatePremium(price, iopv) {
  if (!Number.isFinite(price) || !Number.isFinite(iopv) || iopv <= 0) return null
  return (price - iopv) / iopv * 100
}

app.get('/api/etf/premium', (req, res) => {
  const price = Number(req.query.price)
  const iopv = Number(req.query.iopv)
  const premiumRate = calculatePremium(price, iopv)
  if (premiumRate == null) return res.status(400).json({ error: 'price 和 iopv 必须是有效正数（iopv > 0）' })
  res.json({ symbol: req.query.symbol || null, price, iopv, premiumRate })
})

app.post('/api/etf/premium', (req, res) => {
  const price = Number(req.body?.price)
  const iopv = Number(req.body?.iopv)
  const premiumRate = calculatePremium(price, iopv)
  if (premiumRate == null) return res.status(400).json({ error: 'price 和 iopv 必须是有效正数（iopv > 0）' })
  res.json({ symbol: req.body?.symbol || null, price, iopv, premiumRate })
})

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.resolve(currentDir, '../../client/dist')
app.use(express.static(clientDist))
app.get('*splat', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))

app.listen(port, () => console.log(`行情服务已启动：http://localhost:${port}`))
