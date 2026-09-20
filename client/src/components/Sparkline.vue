<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, CanvasRenderer])

const props = defineProps({
  values: { type: Array, default: () => [] },
  positive: { type: Boolean, default: true }
})

const root = ref(null)
let chart
let observer
const color = computed(() => (props.positive ? '#ef3f4d' : '#13a36f'))
const chartValues = computed(() => props.values.length === 1 ? [props.values[0], props.values[0]] : props.values)
const chartRange = computed(() => {
  const values = chartValues.value.filter(Number.isFinite)
  if (!values.length) return { min: null, max: null }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const middle = (min + max) / 2
  const padding = Math.max((max - min) * 0.1, Math.abs(middle) * 0.00015, 0.001)
  return { min: min - padding, max: max + padding }
})

function draw() {
  if (!chart) return
  chart.setOption({
    animation: false,
    grid: { left: 2, right: 2, top: 5, bottom: 5 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: chartValues.value.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true, min: chartRange.value.min, max: chartRange.value.max },
    series: [{
      type: 'line',
      data: chartValues.value,
      symbol: 'none',
      smooth: 0.12,
      lineStyle: { color: color.value, width: 1.1 },
      areaStyle: { color: color.value, opacity: 0.06 }
    }]
  }, true)
}

onMounted(() => {
  chart = echarts.init(root.value)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(root.value)
  draw()
})
watch(() => [props.values, props.positive], draw, { deep: true })
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose() })
</script>

<template><div ref="root" class="sparkline" /></template>
