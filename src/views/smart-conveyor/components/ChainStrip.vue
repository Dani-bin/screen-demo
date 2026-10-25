<!--
  主煤流一张图：按煤流顺序把皮带和煤仓串成一条（工作面 → 地面原煤仓），每条皮带三行：
  沿线煤量（亮度 = 装载率）、光纤测温（越热越不透明，超过阈值标紫）、八大保护状态灯；宽度按皮带长度分配。
  点一段飞到那条皮带 / 煤仓。
-->
<template>
  <div class="cs">
    <div class="cs-hd">
      <b>主煤流一张图</b><em>MAIN FLOW · 沿线煤量 / 光纤测温 / 八大保护</em>
      <span class="lg"
        ><i class="c"></i>煤量 kg/m <i class="t"></i>温度
        <i class="p"></i>平台预警热点 <i class="g"></i>保护正常</span
      >
    </div>
    <template v-for="x in parts" :key="x.id">
      <div
        v-if="x.bunker"
        class="cs-bk"
        :style="{ left: rem(x.x), width: rem(NODE_W) }"
        @click="emit('pick', x.id)"
      >
        <i :style="{ height: `${(x.level * 100).toFixed(0)}%` }"></i
        ><span class="code">{{ x.id }}</span
        ><b>{{ pct(x.level) }}</b>
      </div>
      <div
        v-else
        class="cs-b"
        :class="{ sel: x.id === selected }"
        :style="{ left: rem(x.x), width: rem(x.w) }"
        @click="emit('pick', x.id)"
      >
        <header>
          <b class="code">{{ x.id }}</b
          ><span>{{ fmt(x.v, 1) }}{{ x.w > 90 ? " m/s" : "" }}</span>
        </header>
        <div class="cs-coal">
          <i
            v-for="(c, i) in x.cells"
            :key="i"
            :style="{ opacity: (0.12 + 0.88 * c).toFixed(2) }"
          ></i>
        </div>
        <div class="cs-dts" :class="{ none: !x.heat }">
          <template v-if="x.heat">
            <i
              v-for="(h, i) in x.heat"
              :key="i"
              :style="{
                opacity: (0.18 + 0.82 * h).toFixed(2),
                background: h > 0.55 ? 'var(--predict)' : 'var(--coal-2)'
              }"
            ></i>
          </template>
          <em v-else>—</em>
        </div>
        <div class="cs-prot">
          <i
            v-for="p in PROTS"
            :key="p[0]"
            :title="p[1]"
            :class="{ trip: x.trip === p[0] }"
          ></i>
        </div>
        <footer>{{ fmt(x.L) }} m</footer>
      </div>
    </template>
    <div class="cs-flow">工作面 → 地面原煤仓 · 共 {{ fmt(totalLen) }} m</div>
  </div>
</template>

<script setup>
  import { PROTS, fmt, pct, rem } from "./ui.js"
  import layout from "../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true },
    selected: { type: String, default: null }
  })
  const emit = defineEmits(["pick"])

  /** 煤流顺序（掘进顺槽 BC06 汇入 MC01，不在主线上，长度计入总长） */
  const ORDER = ["BC05", "BC04", "MC01", "BC03", "MC02", "BC02", "BC01", "MC03"]
  // 版面（设计稿 px）：左右 14 / 994，煤仓节点宽 34，间距 6，最短皮带至少 64
  const X0 = 14
  const X1 = 994
  const NODE_W = 34
  const GAP = 6
  const MINW = 64

  const beltOf = (id) => layout.belts.find((b) => b.id === id)
  const beltIds = ORDER.filter((k) => k.startsWith("BC"))
  const totalLen = layout.belts.reduce((a, b) => a + b.L, 0)

  // 每条皮带的宽度：太短的给最小宽度，其余按长度分剩下的
  const widths = (() => {
    const nBunker = ORDER.length - beltIds.length
    const avail = X1 - X0 - nBunker * NODE_W - (ORDER.length - 1) * GAP
    const sum = beltIds.reduce((a, id) => a + beltOf(id).L, 0)
    const small = beltIds.filter((id) => (beltOf(id).L / sum) * avail < MINW)
    const k =
      (avail - small.length * MINW) /
      beltIds
        .filter((id) => !small.includes(id))
        .reduce((a, id) => a + beltOf(id).L, 0)
    return Object.fromEntries(
      beltIds.map((id) => [id, small.includes(id) ? MINW : beltOf(id).L * k])
    )
  })()

  /** 把长数组按 n 段取最大值 */
  const bucketMax = (arr, n) =>
    Array.from({ length: n }, (_, i) => {
      let v = -Infinity
      const a = Math.floor((i * arr.length) / n)
      const b = Math.max(a + 1, Math.floor(((i + 1) * arr.length) / n))
      for (let k = a; k < b; k++) v = Math.max(v, arr[k])
      return v
    })

  const parts = computed(() => {
    const s = props.f.s
    let x = X0
    return ORDER.map((id) => {
      if (id.startsWith("MC")) {
        const out = { id, bunker: true, x, level: s.bunkers[id].level }
        x += NODE_W + GAP
        return out
      }
      const b = beltOf(id)
      const w = widths[id]
      // 沿线煤量：按额定装载折算成 0…1
      const qFull = b.Q / (3.6 * b.v)
      const prof = props.w.profile[id]
      const cells = bucketMax(
        prof,
        Math.min(prof.length, Math.round(w / 2))
      ).map((v) => Math.min(1, v / qFull))
      // 光纤测温：18–44 °C 映射到 0…1
      const T = props.w.dts[id]
      const heat = T
        ? bucketMax(T, Math.round(w / 2)).map((v) =>
            Math.max(0, Math.min(1, (v - 18) / 26))
          )
        : null
      const st = s.belts[id]
      const out = {
        id,
        x,
        w,
        L: b.L,
        v: st.v,
        cells,
        heat,
        trip: st.protection
      }
      x += w + GAP
      return out
    })
  })
</script>
