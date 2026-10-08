import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCnStock } from '../src/providers/sina.js'

const instrument = {
  id: 'fund',
  name: '场内基金',
  displayCode: '000000.SH',
  assetType: 'stock-cn'
}

function fields({ previousClose, price }) {
  const values = Array(32).fill('')
  values[0] = instrument.name
  values[2] = String(previousClose)
  values[3] = String(price)
  values[30] = '2026-10-08'
  values[31] = '15:00:00'
  return values
}

test('uses the previous close for a suspended instrument reported at zero', () => {
  const quote = parseCnStock(instrument, fields({ previousClose: 1.234, price: 0 }))

  assert.equal(quote.price, 1.234)
  assert.equal(quote.change, 0)
  assert.equal(quote.changePercent, 0)
  assert.equal(quote.status, 'suspended')
})

test('keeps the live price and return for an actively traded instrument', () => {
  const quote = parseCnStock(instrument, fields({ previousClose: 1.2, price: 1.26 }))

  assert.equal(quote.price, 1.26)
  assert.ok(Math.abs(quote.changePercent - 5) < 1e-10)
  assert.equal(quote.status, 'ok')
})

test('does not expose zero as a valid price without a previous close', () => {
  const quote = parseCnStock(instrument, fields({ previousClose: 0, price: 0 }))

  assert.equal(quote.price, null)
  assert.equal(quote.changePercent, null)
  assert.equal(quote.status, 'unavailable')
})
