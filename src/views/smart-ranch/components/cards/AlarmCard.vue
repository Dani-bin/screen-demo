<!-- 告警联动：近景画面（示意）+ 描述 + 处理进度 + 处置按钮；没有告警时显示"运行平稳" -->
<template>
  <section class="card alarm" :class="{ calm: !alarm }">
    <template v-if="alarm">
      <header>
        <h3><i class="dot"></i>{{ alarm.title }}</h3>
        <span class="lv" :class="alarm.level">{{ LEVEL[alarm.level] }}</span>
      </header>
      <figure class="closeup">
        <img :src="img" alt="" />
        <figcaption>联动近景 · {{ alarm.target }}</figcaption>
        <span class="live">LIVE · CAM</span>
      </figure>
      <p class="what">{{ t.what }}</p>
      <dl>
        <dt>位置</dt>
        <dd>{{ t.where }}</dd>
        <dt>发生</dt>
        <dd>{{ hm(alarm.start) }}</dd>
        <dt>派给</dt>
        <dd>放牧员 {{ alarm.herder }}</dd>
        <dt>距离</dt>
        <dd>{{ dist }} km · {{ eta }} 分钟</dd>
      </dl>
      <div class="stepper">
        <template v-for="(s, i) in steps" :key="s">
          <i v-if="i"></i>
          <span :class="{ done: i < k, now: i === k }">{{ STAGE[s] }}</span>
        </template>
      </div>
      <div class="acts">
        <span class="pri" @click="$emit('act', 'video')">查看视频</span>
        <span @click="$emit('act', 'replay')">轨迹回放</span>
        <span @click="$emit('act', 'call')">电话放牧员</span>
        <span @click="$emit('act', 'close')">关闭告警</span>
      </div>
    </template>
    <template v-else>
      <header>
        <h3>告警联动</h3>
        <span class="hint">当前无未处理告警</span>
      </header>
      <figure class="closeup calm-img">
        <img :src="img" alt="" />
        <figcaption>全场运行平稳 · 自动巡游中</figcaption>
      </figure>
    </template>
  </section>
</template>

<script setup>
  import { alarmText, hm, LEVEL, STAGE } from "../../utils.js"

  const props = defineProps({
    alarm: { type: Object, default: null },
    layout: { type: Object, required: true },
    img: { type: String, required: true }
  })
  defineEmits(["act"])
  const steps = ["pending", "dispatched", "handling", "resolved"]
  const k = computed(() => steps.indexOf(props.alarm?.stage))
  const t = computed(() => alarmText(props.alarm, props.layout))
  // 放牧员到事发处的距离：按告警编号播种的示意值（0.6–2.2 km，骑摩托约 12 km/h）
  const dist = computed(() => {
    let a = 0
    for (const ch of String(props.alarm?.id))
      a = (a * 31 + ch.charCodeAt(0)) % 997
    return (0.6 + (a / 997) * 1.6).toFixed(1)
  })
  const eta = computed(() => Math.max(2, Math.round((dist.value / 12) * 60)))
</script>
