<!-- 三机编队：每架一行（角色、任务、链路、电量、高度、地速），点击行 = 选中并让镜头跟随 -->
<template>
  <div class="card" style="left: 36px; top: 112px; width: 450px; height: 284px">
    <div class="hd">
      <Icon name="drone" /><span class="t">三机编队</span>
      <span class="s">在线 3 / 3 · 全部自检通过</span>
    </div>
    <div
      v-for="d in snap.drones"
      :key="d.id"
      class="row-uav"
      style="cursor: pointer"
      @click="$emit('pick', d.id)"
    >
      <div class="g" :style="{ color: COLOR[d.id] }">
        <svg viewBox="-30 -30 60 60">
          <use
            :href="d.id === 'UAV-01' ? '#drone6' : '#drone4'"
            x="-30"
            y="-30"
            width="60"
            height="60"
          />
        </svg>
      </div>
      <div>
        <div class="l1">
          <b>{{ d.id }} · {{ d.role }}</b>
          <span class="r">
            <span class="chip gold">{{ d.taskText }}</span>
            <span v-if="d.link" class="chip warn"
              ><Icon name="swap" :size="13" style="stroke: var(--warn)" />2.4G
              备用</span
            >
            <span v-else class="chip">5.8G</span>
          </span>
        </div>
        <div class="l2">
          <span class="bat"
            ><i
              :style="{
                width: d.batt + '%',
                background: d.batt < 30 ? 'var(--warn)' : 'var(--ink-2)'
              }"
            ></i
          ></span>
          <span class="num">{{ Math.round(d.batt) }}%</span>
          <span
            >高度 <span class="num">{{ d.alt.toFixed(1) }}</span> m</span
          >
          <span
            >地速 <span class="num">{{ d.spd.toFixed(1) }}</span> m/s</span
          >
        </div>
      </div>
    </div>
    <div class="foot" style="margin-top: 2px">
      <Icon name="shield" :size="14" />
      <span v-html="note"></span>
    </div>
  </div>
</template>

<script setup>
  import { computed } from "vue"
  import Icon from "./Icon.vue"

  const props = defineProps({ snap: { type: Object, required: true } })
  defineEmits(["pick"])
  const COLOR = {
    "UAV-01": "var(--uav-1)",
    "UAV-02": "var(--uav-2)",
    "UAV-03": "var(--uav-3)"
  }

  /** 底部一句话：随当前状态变化 */
  const note = computed(() => {
    const s = props.snap
    const d3 = s.drones[2]
    const g = (t) =>
      `<b style="color:var(--gold-hi);font-weight:normal">${t}</b>`
    if (s.target.status === 1)
      return `疑似目标已转入 ${g("核验")}：一号机锁定区域，三号机抵近 ${d3.alt.toFixed(1)} m`
    if (s.target.status === 2)
      return `目标已${g("确认")}，融合定位误差 ${s.target.err.toFixed(1)} m，已推送保安与家属`
    if (s.drones.some((d) => d.airborne))
      return `任务进行中：${s.mission.title}`
    return "三机待命于屋顶机库，自检通过，随时可出动"
  })
</script>
