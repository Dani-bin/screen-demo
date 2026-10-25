<!--
  剧本演示层：
    - 顶部横条：「剧本演示 · 非实时数据」+ 剧本名 + 可拖动进度条（每一步一个刻度）+ 暂停 / 继续 / 退出
    - 字幕：当前一步的大字说明（三维区下方），前后步骤淡显
    - 说明卡（三维区右侧）：如果不处理的对照、撕裂长度、告警推送、视频回放、处置派单、越界报警时延
  预热（剧本跨好几天时先把仿真段算好）期间显示进度。
-->
<template>
  <div class="sc">
    <div class="sc-bar">
      <span class="sc-tag">剧本演示 · 非实时数据</span>
      <b>{{ run.name }}</b>
      <div
        ref="trackRef"
        class="sc-track"
        @pointerdown="onDown"
        @pointermove="onDrag"
        @pointerup="dragging = false"
        @pointerleave="dragging = false"
      >
        <i :style="{ width: `${k * 100}%` }"></i>
        <u
          v-for="(s, i) in steps"
          :key="i"
          :class="{ on: i <= run.step }"
          :style="{ left: `${(s.at / run.dur) * 100}%` }"
        ></u>
      </div>
      <span class="code">{{ fmtS(run.el) }} / {{ fmtS(run.dur) }}</span>
      <a v-if="!run.paused" @click="emit('pause')"><Ic name="pause" /></a>
      <a v-else @click="emit('resume')"><Ic name="play" /></a>
      <a class="x" @click="emit('stop')"><Ic name="close" />退出</a>
    </div>

    <div v-if="run.loading" class="sc-load">
      <span>剧本准备中 · 预算仿真数据</span>
      <div class="bar"><i :style="{ width: `${run.loading * 100}%` }"></i></div>
    </div>

    <div v-else-if="cur" class="sc-cap">
      <em class="code"
        >STEP {{ String(run.step + 1).padStart(2, "0") }} /
        {{ String(steps.length).padStart(2, "0") }}</em
      >
      <p :key="run.step">{{ cur.text }}</p>
      <span class="sc-sim">剧本时刻 {{ simText }}</span>
    </div>

    <div class="sc-cards">
      <template v-for="c in cards" :key="c.kind">
        <!-- 托辊：平台预警 vs 如果不处理 -->
        <div v-if="c.kind === 'compare'" class="scc compare">
          <header>同一个托辊，两种结局</header>
          <div class="cmp">
            <div class="ok">
              <b>平台预警</b>
              <ul>
                <li>
                  提前 <strong>{{ c.lead.toFixed(1) }}</strong> 天发现
                </li>
                <li>零点班计划检修 {{ c.fixMin }} 分钟</li>
                <li>停产 <strong>0</strong></li>
              </ul>
            </div>
            <div class="bad">
              <b>如果不处理（只有集控）</b>
              <ul>
                <li>轴承卡死 → 摩擦升温</li>
                <li>烟雾 / 超温保护跳闸</li>
                <li>
                  非计划停机约 <strong>{{ c.downH }}</strong> h · 少出煤约
                  <strong>{{ fmt(c.tons) }}</strong> t
                </li>
              </ul>
            </div>
          </div>
          <footer>集控保护只在故障发生那一刻动作；平台在劣化初期就预警</footer>
        </div>
        <!-- 纵撕：撕裂长度 -->
        <div v-else-if="c.kind === 'tear'" class="scc tear">
          <header>纵向撕裂长度</header>
          <div class="tear-bar">
            <i :style="{ width: `${(c.len / c.limit) * 100}%` }"></i>
            <u></u>
          </div>
          <p>
            <b>{{ c.len.toFixed(1) }} m</b
            ><span>停机前扩展上限 {{ c.limit }} m</span>
          </p>
        </div>
        <!-- 告警推送 -->
        <div v-else-if="c.kind === 'push'" class="scc push">
          <header>告警推送 · 已送达</header>
          <ul>
            <li v-for="p in c.to" :key="p">
              <Ic name="check" class="ok" />{{ p }}
            </li>
          </ul>
        </div>
        <!-- 视频回放 -->
        <div v-else-if="c.kind === 'video'" class="scc video">
          <header>视频回放 · {{ c.cam }}</header>
          <div class="vid">
            <CamView
              :cam="{ id: c.cam, state: 'online', conf: 96 }"
              :v="1.2"
              :load="0.8"
              :hit="c.hit"
              :now="c.at"
              :seed="21"
            />
          </div>
        </div>
        <!-- 派单 -->
        <div v-else-if="c.kind === 'order'" class="scc order">
          <header>处置派单 · {{ c.id }}</header>
          <p>{{ c.title }}</p>
          <span>{{ c.crew }} 人 · 预计 {{ c.hours }} h · 已接单</span>
        </div>
        <!-- 人员越界 -->
        <div v-else-if="c.kind === 'intrude'" class="scc intrude">
          <header>人员越界 · 报警时延</header>
          <p>
            <b>{{ c.latency }} s</b
            ><span
              >UWB 电子围栏 {{ c.uwb }} + AI 视频 {{ c.cam }} 双重确认</span
            >
          </p>
          <span>声光报警 → 软停闭锁 → 撤离确认 → 复位起车</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
  import Ic from "./Ic.vue"
  import CamView from "./run/CamView.vue"
  import { fmt, hm, md } from "./ui.js"

  const props = defineProps({
    run: { type: Object, required: true },
    steps: { type: Array, default: () => [] },
    cards: { type: Array, default: () => [] },
    now: { type: Number, default: 0 }
  })
  const emit = defineEmits(["pause", "resume", "stop", "seek"])

  const k = computed(() => (props.run.dur ? props.run.el / props.run.dur : 0))
  const cur = computed(() => props.steps[props.run.step] || null)
  const simText = computed(() => `${md(props.now)} ${hm(props.now)}`)
  const fmtS = (x) =>
    `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`

  // 进度条拖动
  const trackRef = ref(null)
  const dragging = ref(false)
  function seekAt(e) {
    const r = trackRef.value.getBoundingClientRect()
    emit("seek", ((e.clientX - r.left) / r.width) * props.run.dur)
  }
  function onDown(e) {
    dragging.value = true
    seekAt(e)
  }
  function onDrag(e) {
    if (dragging.value) seekAt(e)
  }
</script>
