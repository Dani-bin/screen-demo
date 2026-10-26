<!-- A1 人：井下人数按区域分布、今日越界 / 未戴安全帽 / 危险区闯入次数、UWB 基站在线率 -->
<template>
  <Panel no="A1" title="人 · 人员安全" en="PERSON · UWB + AI">
    <div class="ps">
      <div class="ps-n">
        <Ic name="user" /><b>{{ f.s.kpi.peopleUnderground }}</b
        ><span>人在井下</span>
      </div>
      <div class="ps-ev">
        <div v-for="x in counts" :key="x.k" :class="{ hot: x.n > 0 }">
          <b>{{ x.n }}</b
          ><span>{{ x.k }}</span>
        </div>
      </div>
    </div>
    <div class="ps-areas">
      <div v-for="a in areas" :key="a.id" class="ps-a">
        <span>{{ a.name }}</span>
        <div class="bar">
          <i :style="{ width: `${(a.n / maxN) * 100}%` }"></i>
        </div>
        <b>{{ a.n }}</b>
      </div>
    </div>
    <p class="ps-uwb" :class="{ q: offline }">
      <Ic name="pin" />UWB 基站在线
      <b>{{ f.uwb.length - offline }}/{{ f.uwb.length }}</b>
      <em v-if="offline">{{ offline }} 个离线，覆盖区人数为过期数据</em>
      <em v-else>定位精度 0.3 m · 电子围栏 {{ fences }} 处</em>
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })

  const counts = computed(() => {
    const t = props.w.today
    const n = (...k) => t.filter((e) => k.includes(e.kind)).length
    return [
      { k: "越界", n: n("fence") },
      { k: "危险区闯入", n: n("intrude") },
      { k: "未戴安全帽", n: n("helmet") }
    ]
  })
  /** 区域：两个工作面 + 井下 5 条皮带 */
  const areas = computed(() => {
    const p = props.f.people
    return [
      { id: "WF12301", name: "12301 综采面" },
      { id: "WF12305", name: "12305 掘进面" },
      ...layout.belts
        .filter((b) => b.area !== "surface")
        .map((b) => ({ id: b.id, name: b.short }))
    ].map((a) => ({ ...a, n: p[a.id] || 0 }))
  })
  const maxN = computed(() => Math.max(1, ...areas.value.map((a) => a.n)))
  const offline = computed(() => props.f.uwb.filter((u) => !u.online).length)
  // 每条皮带机头、机尾各一处电子围栏
  const fences = layout.belts.length * 2
</script>
