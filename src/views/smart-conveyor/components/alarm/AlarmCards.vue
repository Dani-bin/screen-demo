<!--
  A6 实时告警详情：每条未结束告警一张卡（抓拍示意、位置、六感手段、时间、处置人、状态），一次显示 3 张，
  每 5 秒轮换一张；点卡片三维飞过去
-->
<template>
  <Panel no="A6" title="实时告警详情" en="LIVE ALARM CARDS">
    <div class="ac">
      <div
        v-for="a in shown"
        :key="a.id"
        class="ac-c"
        :class="{ pred: a.predictive }"
        @click="emit('pick', a)"
      >
        <div class="ac-shot">
          <CamView
            :cam="{
              id: a.cam || a.device || a.id,
              state: 'online',
              conf: a.predictive ? 88 : 95
            }"
            :v="a.predictive ? 1.8 : 0.6"
            :load="0.6"
            :hit="a.predictive ? '' : HIT[a.kind] || ''"
            :now="a.at"
            :seed="a.seed"
          />
        </div>
        <div class="ac-t">
          <header>
            <LvTag :l="a.level" /><DimTag :k="a.dim" /><b>{{ a.title }}</b>
          </header>
          <p>
            <Ic :name="SENSE_ICON[a.sense] || 'pin'" />{{ a.sense }} ·
            {{ loc(a) }}
          </p>
          <footer>
            <span>{{ md(a.at) }} {{ hm(a.at) }}</span
            ><em>{{ a.status }}</em
            ><span>{{ a.who }}</span>
          </footer>
        </div>
      </div>
      <p v-if="!list.length" class="ac-none">当前没有未结束告警</p>
    </div>
    <div class="ac-dots">
      <i v-for="(a, i) in list" :key="a.id" :class="{ on: isShown(i) }"></i>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import CamView from "../run/CamView.vue"
  import { DimTag, LvTag } from "../tags.js"
  import { SENSE_ICON, beltShort, fmt, hm, md } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({ f: { type: Object, required: true } })
  const emit = defineEmits(["pick"])

  const HIT = {
    foreign: "异物",
    bigLump: "大块",
    intrude: "人员越界",
    fence: "越界",
    helmet: "未戴安全帽",
    blockage: "堵料"
  }
  /** 处置人（演示：按告警编号固定分给当班人员） */
  const CREW = [
    "调度 王建国",
    "机电 刘志强",
    "巡检 姜文斌",
    "安监 赵海涛",
    "机电 周立新"
  ]
  const hash = (s) =>
    [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const cams = layout.devices.filter((d) => d.kind === "camera")
  /** 离告警位置最近的摄像机 */
  const nearestCam = (a) => {
    let best = null
    let bd = Infinity
    for (const c of cams)
      if (c.belt === a.belt) {
        const d = Math.abs(c.chainage - (a.chainage ?? 0))
        if (d < bd) [bd, best] = [d, c]
      }
    return best?.id
  }
  const list = computed(() =>
    props.f.s.alarms.map((a) => ({
      ...a,
      cam: nearestCam(a),
      seed: hash(a.id) % 97,
      who:
        a.status === "未处理" || a.status === "待确认"
          ? "待分派"
          : CREW[hash(a.id) % CREW.length]
    }))
  )
  // 轮换：每 5 秒前进一张
  const k = ref(0)
  let timer = 0
  onMounted(() => (timer = setInterval(() => k.value++, 5000)))
  onBeforeUnmount(() => clearInterval(timer))
  const N = 3
  const isShown = (i) => {
    const n = list.value.length
    if (n <= N) return true
    const start = k.value % n
    return (i - start + n) % n < N
  }
  const shown = computed(() => list.value.filter((_, i) => isShown(i)))
  const loc = (a) =>
    `${a.belt ? beltShort(layout, a.belt) : ""}${a.chainage != null ? ` · ${fmt(a.chainage)} m` : ""}`
</script>
