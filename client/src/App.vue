<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Sparkline from './components/Sparkline.vue'

const rows = ref([])
const histories = ref({})
const loading = ref(true)
const error = ref('')
const lastUpdated = ref(null)
const latency = ref(null)
const stockCode = ref('')
const addError = ref('')
const customSymbols = ref([])
const savedOrders = ref({})
const sortStates = ref({})
const draggingId = ref('')
let timer
let historyTimer
let controller
let longPress = null

function orderedRows(groupTitle, list) {
  const order = savedOrders.value[groupTitle] || []
  const positions = new Map(order.map((id, index) => [id, index]))
  return [...list].sort((a, b) => {
    const aPosition = positions.has(a.id) ? positions.get(a.id) : Number.MAX_SAFE_INTEGER
    const bPosition = positions.has(b.id) ? positions.get(b.id) : Number.MAX_SAFE_INTEGER
    return aPosition - bPosition
  })
}

function sortedRows(groupTitle, list) {
  const ordered = orderedRows(groupTitle, list)
  const sort = sortStates.value[groupTitle]
  if (!sort?.key) return ordered
  return [...ordered].sort((a, b) => {
    const aValue = a[sort.key]
    const bValue = b[sort.key]
    if (!Number.isFinite(aValue)) return 1
    if (!Number.isFinite(bValue)) return -1
    return (aValue - bValue) * (sort.direction === 'asc' ? 1 : -1)
  })
}

function toggleSort(group, key) {
  const current = sortStates.value[group]
  sortStates.value = {
    ...sortStates.value,
    [group]: current?.key === key
      ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
      : { key, direction: 'desc' }
  }
}

function sortMark(group, key) {
  const state = sortStates.value[group]
  if (state?.key !== key) return '↕'
  return state.direction === 'desc' ? '↓' : '↑'
}

const groups = computed(() => [
  { title: '中国', flag: '/flags/cn.svg', headlineIds: ['sse-composite', 'star-50'], rows: rows.value.filter(item => item.marketGroup === '中国' || (!item.marketGroup && ['index-cn', 'stock-cn'].includes(item.assetType))) },
  { title: '美国', flag: '/flags/us.svg', headlineIds: ['nasdaq-future', 'sp500-future'], rows: rows.value.filter(item => item.marketGroup === '美国' || (!item.marketGroup && item.assetType === 'futures')) },
  { title: '日本', flag: '/flags/jp.svg', headlineIds: ['nikkei-225', 'topix'], rows: rows.value.filter(item => item.marketGroup === '日本' || (!item.marketGroup && item.assetType === 'index-global')) },
  { title: '韩国', flag: '/flags/kr.svg', headlineIds: ['kospi'], rows: rows.value.filter(item => item.marketGroup === '韩国' || (!item.marketGroup && item.assetType === 'stock-kr')) },
  { title: '全球', flag: '', headlineIds: [], rows: rows.value.filter(item => item.marketGroup === '全球') }
].map(group => ({
  ...group,
  headlineRows: group.headlineIds.map(id => group.rows.find(item => item.id === id)).filter(Boolean),
  bodyRows: sortedRows(group.title, group.rows.filter(item => !group.headlineIds.includes(item.id)))
})))

const clock = computed(() => lastUpdated.value
  ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(lastUpdated.value)
  : '--:--:--')

function formatPrice(value) {
  if (!Number.isFinite(value)) return '--'
  if (value >= 100000) return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  if (value >= 1000) return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

async function fetchQuotes() {
  controller?.abort()
  controller = new AbortController()
  const started = performance.now()
  try {
    const query = customSymbols.value.length ? `?symbols=${encodeURIComponent(customSymbols.value.join(','))}` : ''
    const response = await fetch(`/api/quotes${query}`, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`行情服务返回 ${response.status}`)
    const payload = await response.json()
    rows.value = payload.data
    for (const item of payload.data) {
      if (!Number.isFinite(item.price)) continue
      const values = histories.value[item.id] || []
      histories.value[item.id] = values.length > 1
        ? [...values.slice(0, -1), item.price]
        : [item.price, item.price]
    }
    lastUpdated.value = new Date()
    latency.value = Math.round(performance.now() - started)
    error.value = payload.errors?.length ? `部分行情暂不可用：${payload.errors.join('；')}` : ''
  } catch (err) {
    if (err.name !== 'AbortError') error.value = `刷新失败：${err.message}`
  } finally {
    loading.value = false
  }
}

async function fetchIntraday() {
  try {
    const query = customSymbols.value.length ? `?symbols=${encodeURIComponent(customSymbols.value.join(','))}` : ''
    const response = await fetch(`/api/intraday${query}`)
    if (!response.ok) return
    const payload = await response.json()
    for (const [id, values] of Object.entries(payload.data || {})) {
      if (values.length) histories.value[id] = values
    }
  } catch { /* 实时价格仍可继续使用 */ }
}

function normalizeAStock(value) {
  const digits = value.trim().replace(/\D/g, '')
  if (!/^\d{6}$/.test(digits)) return null
  if (digits.startsWith('6')) return `sh${digits}`
  if (digits.startsWith('0') || digits.startsWith('3')) return `sz${digits}`
  if (digits.startsWith('4') || digits.startsWith('8')) return `bj${digits}`
  return null
}

async function addStock() {
  const symbol = normalizeAStock(stockCode.value)
  if (!symbol) { addError.value = '请输入有效的 6 位 A 股代码'; return }
  if (customSymbols.value.includes(symbol)) { addError.value = '这只股票已经添加'; return }
  customSymbols.value = [...customSymbols.value, symbol]
  localStorage.setItem('market-board-cn-symbols', JSON.stringify(customSymbols.value))
  stockCode.value = ''
  addError.value = ''
  await Promise.all([fetchQuotes(), fetchIntraday()])
  const added = rows.value.find(item => item.id === `custom-${symbol}`)
  if (!added || added.status !== 'ok') {
    removeStock(symbol)
    addError.value = '没有查到这个代码，请检查后重试'
  }
}

function removeStock(symbol) {
  customSymbols.value = customSymbols.value.filter(item => item !== symbol)
  localStorage.setItem('market-board-cn-symbols', JSON.stringify(customSymbols.value))
  rows.value = rows.value.filter(item => item.id !== `custom-${symbol}`)
}

function stopLongPress() {
  if (!longPress) return
  clearTimeout(longPress.timer)
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', stopLongPress)
  window.removeEventListener('pointercancel', stopLongPress)
  draggingId.value = ''
  longPress = null
}

function handlePointerMove(event) {
  if (!longPress) return
  if (!longPress.active) {
    if (Math.hypot(event.clientX - longPress.startX, event.clientY - longPress.startY) > 7) stopLongPress()
    return
  }
  event.preventDefault()
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-quote-id]')
  if (!target || target.dataset.group !== longPress.group || target.dataset.quoteId === longPress.id) return
  const group = groups.value.find(item => item.title === longPress.group)
  const ids = group?.bodyRows.map(item => item.id) || []
  const from = ids.indexOf(longPress.id)
  const to = ids.indexOf(target.dataset.quoteId)
  if (from < 0 || to < 0) return
  ids.splice(to, 0, ids.splice(from, 1)[0])
  savedOrders.value = { ...savedOrders.value, [longPress.group]: ids }
  localStorage.setItem('market-board-orders', JSON.stringify(savedOrders.value))
}

function startLongPress(event, group, id) {
  if (event.button !== 0) return
  stopLongPress()
  longPress = {
    id,
    group,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    timer: window.setTimeout(() => {
      if (!longPress) return
      longPress.active = true
      draggingId.value = id
    }, 350)
  }
  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', stopLongPress, { once: true })
  window.addEventListener('pointercancel', stopLongPress, { once: true })
}

onMounted(async () => {
  try { customSymbols.value = JSON.parse(localStorage.getItem('market-board-cn-symbols') || '[]') } catch { customSymbols.value = [] }
  try { savedOrders.value = JSON.parse(localStorage.getItem('market-board-orders') || '{}') } catch { savedOrders.value = {} }
  await Promise.all([fetchQuotes(), fetchIntraday()])
  timer = window.setInterval(fetchQuotes, 1000)
  historyTimer = window.setInterval(fetchIntraday, 5 * 60 * 1000)
})
onBeforeUnmount(() => { clearInterval(timer); clearInterval(historyTimer); controller?.abort(); stopLongPress() })
</script>

<template>
  <main class="shell">
    <div v-if="error" class="notice">{{ error }}</div>
    <div v-if="loading" class="loading">正在连接真实行情源…</div>

    <div class="dashboard-grid">
      <section v-for="group in groups.slice(0, 2)" :key="group.title" class="market-group" :class="`market-${group.title}`">
        <header class="group-title">
          <div class="country-title" :title="group.title"><img class="flag" :src="group.flag" :alt="group.title" /></div>

          <div class="headline-strip">
            <div v-for="item in group.headlineRows" :key="item.id" class="headline-quote">
              <span>{{ item.name.replace('指数', '').replace('期货', '') }}</span>
              <strong :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPrice(item.price) }}</strong>
              <em :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.changePercent) }}</em>
            </div>
          </div>

        </header>

        <div class="table-card">
          <div class="table-head row-grid" :class="{ 'premium-grid': ['美国', '日本'].includes(group.title) }">
            <span>名称 / 代码</span><span>最新价</span>
            <button v-if="['美国', '日本'].includes(group.title)" class="sort-head" type="button" @click="toggleSort(group.title, 'premiumRate')">溢价率 <i>{{ sortMark(group.title, 'premiumRate') }}</i></button>
            <button v-if="['美国', '日本'].includes(group.title)" class="sort-head" type="button" @click="toggleSort(group.title, 'changePercent')">涨跌幅 <i>{{ sortMark(group.title, 'changePercent') }}</i></button>
            <button v-if="['美国', '日本'].includes(group.title)" class="sort-head" type="button" @click="toggleSort(group.title, 'ytdChangePercent')">年初至今 <i>{{ sortMark(group.title, 'ytdChangePercent') }}</i></button>
            <button v-if="['美国', '日本'].includes(group.title)" class="sort-head" type="button" @click="toggleSort(group.title, 'oneYearChangePercent')">近一年 <i>{{ sortMark(group.title, 'oneYearChangePercent') }}</i></button>
            <span v-else>涨跌幅</span><span>分时</span>
          </div>
          <article v-for="item in group.bodyRows" :key="item.id" class="quote-row row-grid sortable-row" :class="{ dragging: draggingId === item.id, 'premium-grid': ['美国', '日本'].includes(group.title) }" :data-quote-id="item.id" :data-group="group.title" @pointerdown="startLongPress($event, group.title, item.id)">
            <div class="identity">
              <strong>{{ item.name }}</strong>
              <span>{{ item.displayCode }}</span>
              <button v-if="item.custom" class="remove" type="button" aria-label="删除自选" @click="removeStock(item.id.replace('custom-', ''))">×</button>
            </div>
            <div class="price" :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPrice(item.price) }}</div>
            <div v-if="['美国', '日本'].includes(group.title)" class="premium" :class="item.premiumRate >= 0 ? 'up' : 'down'" :title="Number.isFinite(item.iopv) ? `参考值 ${formatPrice(item.iopv)}` : ''">{{ formatPercent(item.premiumRate) }}</div>
            <div class="change" :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.changePercent) }}</div>
            <div v-if="['美国', '日本'].includes(group.title)" class="ytd" :class="item.ytdChangePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.ytdChangePercent) }}</div>
            <div v-if="['美国', '日本'].includes(group.title)" class="one-year" :class="item.oneYearChangePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.oneYearChangePercent) }}</div>
            <Sparkline :values="histories[item.id] || []" :positive="item.changePercent >= 0" />
          </article>
        </div>
      </section>

      <section class="market-group asia-group">
        <div v-for="group in groups.slice(2)" :key="group.title" class="asia-section" :class="`market-${group.title}`">
          <header class="group-title">
            <div class="country-title" :title="group.title">
              <img v-if="group.flag" class="flag" :src="group.flag" :alt="group.title" />
              <span v-else class="global-mark">🌐 <b>全球</b></span>
            </div>

            <div class="headline-strip">
              <div v-for="item in group.headlineRows" :key="item.id" class="headline-quote">
                <span>{{ item.name.replace('指数', '').replace('期货', '') }}</span>
                <strong :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPrice(item.price) }}</strong>
                <em :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.changePercent) }}</em>
              </div>
              <div v-if="group.title === '韩国'" class="status header-status" :class="{ offline: error && !rows.length }">
                <span class="pulse" />
                <div><strong>{{ clock }}</strong><small>{{ latency == null ? '连接中' : `${latency} ms · 1秒刷新` }}</small></div>
              </div>
            </div>

          </header>

          <div class="table-card">
            <div class="table-head row-grid" :class="{ 'premium-grid': ['美国', '日本'].includes(group.title) }">
              <span>名称 / 代码</span><span>最新价</span>
              <button v-if="['美国', '日本'].includes(group.title)" class="sort-head" type="button" @click="toggleSort(group.title, 'premiumRate')">溢价率 <i>{{ sortMark(group.title, 'premiumRate') }}</i></button>
              <button v-if="['美国', '日本'].includes(group.title)" class="sort-head" type="button" @click="toggleSort(group.title, 'changePercent')">涨跌幅 <i>{{ sortMark(group.title, 'changePercent') }}</i></button>
              <button v-if="['美国', '日本'].includes(group.title)" class="sort-head" type="button" @click="toggleSort(group.title, 'ytdChangePercent')">年初至今 <i>{{ sortMark(group.title, 'ytdChangePercent') }}</i></button>
              <button v-if="['美国', '日本'].includes(group.title)" class="sort-head" type="button" @click="toggleSort(group.title, 'oneYearChangePercent')">近一年 <i>{{ sortMark(group.title, 'oneYearChangePercent') }}</i></button>
              <span v-else>涨跌幅</span><span>分时</span>
            </div>
            <article v-for="item in group.bodyRows" :key="item.id" class="quote-row row-grid sortable-row" :class="{ dragging: draggingId === item.id, 'premium-grid': ['美国', '日本'].includes(group.title) }" :data-quote-id="item.id" :data-group="group.title" @pointerdown="startLongPress($event, group.title, item.id)">
              <div class="identity">
                <strong>{{ item.name }}</strong>
                <span>{{ item.displayCode }}</span>
              </div>
              <div class="price" :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPrice(item.price) }}</div>
              <div v-if="['美国', '日本'].includes(group.title)" class="premium" :class="item.premiumRate >= 0 ? 'up' : 'down'" :title="Number.isFinite(item.iopv) ? `参考值 ${formatPrice(item.iopv)}` : ''">{{ formatPercent(item.premiumRate) }}</div>
              <div class="change" :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.changePercent) }}</div>
              <div v-if="['美国', '日本'].includes(group.title)" class="ytd" :class="item.ytdChangePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.ytdChangePercent) }}</div>
              <div v-if="['美国', '日本'].includes(group.title)" class="one-year" :class="item.oneYearChangePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.oneYearChangePercent) }}</div>
              <Sparkline :values="histories[item.id] || []" :positive="item.changePercent >= 0" />
            </article>
          </div>
        </div>
      </section>
    </div>

  </main>
</template>
