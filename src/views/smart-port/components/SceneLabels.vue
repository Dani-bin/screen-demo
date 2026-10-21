<!--
  场景标签层（DOM，叠在三维画布上）：船名牌 + 引线、岸桥编号牌、主告警卡 + 引线、定位中断的 AGV、泊位刻度、实时角标。
  锚点来自 PortScene.anchors()（画布像素），每帧由 index.vue 更新；告警卡水平方向限定在两侧栏之间。
-->
<template>
  <div class="labels">
    <svg class="lead">
      <template v-for="s in ships" :key="'l' + s.id">
        <line :x1="s.x" :y1="s.y" :x2="s.ax" :y2="s.ay" />
        <circle :cx="s.ax" :cy="s.ay" r="3" />
      </template>
      <g v-if="al && al.lead" class="al">
        <line :x1="al.lx" :y1="al.y + al.hgt" :x2="al.ax" :y2="al.ay" />
        <circle :cx="al.ax" :cy="al.ay" r="4" />
      </g>
    </svg>
    <div v-for="b in berths" :key="b.id" class="berth" :style="pos(b)">
      {{ b.id }}
    </div>
    <template v-if="show.ships">
      <div
        v-for="s in ships"
        :key="s.id"
        class="plate"
        :class="{ tracked: s.id === track }"
        :style="{ left: s.x + 'px', top: s.y + 'px' }"
        @click="$emit('vessel', s.id)"
      >
        <div class="pl-h">
          <i v-html="ICON.ship"></i><b>{{ s.v.name }}</b
          ><em>{{ s.v.clsName }}</em>
        </div>
        <div class="pl-r">
          <span>进度</span><b>{{ pct(s.v.done / s.v.moves) }}</b
          ><span>船时</span><b>{{ s.v.rate ? fmt(s.v.rate) : "—" }}</b>
        </div>
        <i :style="{ width: (s.v.done / s.v.moves) * 100 + '%' }"></i>
      </div>
    </template>
    <template v-if="show.cranes">
      <div
        v-for="c in cranes"
        :key="c.id"
        class="qc-tag"
        :class="c.c.state"
        :style="{ left: c.p.x + 'px', top: c.p.y - c.lift + 'px' }"
        @click="$emit('crane', c.id)"
      >
        <span class="code">{{ c.id }}</span
        ><b>{{ c.c.state === "fault" ? "停机" : fmt(c.c.rate) }}</b
        ><i v-if="c.lift" class="stem" :style="{ height: c.lift + 'px' }"></i>
      </div>
    </template>
    <div
      v-for="a in stale"
      :key="a.id"
      class="stale"
      :class="{ r: a.right }"
      :style="pos(a)"
    >
      <i></i><span class="code">{{ a.id }}</span
      >定位中断 {{ a.min }} 分钟 · 数据过期
    </div>
    <div
      v-if="al"
      class="al-card"
      :style="{ left: al.x + 'px', top: al.y + 'px' }"
      @click="$emit('alarm', alarm)"
    >
      <div class="al-h">
        <i v-html="ICON.alert"></i><b>{{ alarm.title }}</b
        ><em>{{ LEVEL_CN[alarm.level] }}</em>
      </div>
      <div class="al-b">
        <span class="code">{{ alarm.target }}</span> · {{ alarm.desc }}
      </div>
      <div class="al-f">
        <span
          >{{ hm(alarm.at) }} · {{ EV_STATUS[alarm.status] }} ·
          {{ alarm.team }}</span
        ><a @click.stop="$emit('dispatch', alarm)">派单</a>
      </div>
    </div>
    <div class="live">
      <i></i>数字孪生 · 实时<span class="code">LIVE · 1 s</span>
    </div>
  </div>
</template>

<script setup>
  import { EV_STATUS, ICON, LEVEL_CN, fmt, hm, pct } from "../utils.js"

  const props = defineProps({
    /** PortScene.anchors() */
    a: { type: Object, default: null },
    state: { type: Object, required: true },
    alarm: { type: Object, default: null },
    /** 主告警的三维锚点（屏幕像素） */
    alarmAt: { type: Object, default: null },
    track: { type: String, default: "" },
    /** 岸桥编号牌：空 = 不显示，"*" = 所有在作业的岸桥，航次编号 = 只给这条船的岸桥 */
    craneTags: { type: String, default: "" },
    /** 两侧栏的内边（屏幕像素）：标签不压到栏上 */
    bounds: { type: Object, default: () => ({ left: 0, right: 1920, top: 0 }) },
    /** 1 设计稿像素 = 多少屏幕像素 */
    unit: { type: Number, default: 1 },
    /** 图层开关（ships 管船名牌，cranes 管岸桥牌） */
    show: { type: Object, default: () => ({ ships: true, cranes: true }) }
  })
  defineEmits(["vessel", "crane", "alarm", "dispatch"])
  const inView = (p) =>
    p &&
    p.x > props.bounds.left &&
    p.x < props.bounds.right &&
    p.y > props.bounds.top &&
    p.y < 1e4
  const pos = (o) => ({ left: o.p.x + "px", top: o.p.y + "px" })

  const ships = computed(() => {
    if (!props.a) return []
    const byId = new Map(props.state.vessels.map((v) => [v.id, v]))
    const u = props.unit
    return props.a.ships
      .filter((s) => inView(s.p) && byId.get(s.id))
      .map((s) => ({
        id: s.id,
        v: byId.get(s.id),
        // 名牌在船的海侧下方 60 设计像素，引线连回船
        x: Math.min(props.bounds.right - 190 * u, s.p.x - 60 * u),
        y: s.p.y + 70 * u,
        ax: s.p.x,
        ay: s.p.y
      }))
  })
  const cranes = computed(() => {
    if (!props.a || !props.craneTags) return []
    const byId = new Map(props.state.cranes.map((c) => [c.id, c]))
    const list = props.a.cranes
      .map((c) => ({ ...c, c: byId.get(c.id), lift: 0 }))
      .filter(
        (c) =>
          inView(c.p) &&
          // 牌子以锚点居中、宽约 58 设计像素：离侧栏不到半个牌宽就不标，免得压到栏上
          c.p.x > props.bounds.left + 30 * props.unit &&
          c.p.x < props.bounds.right - 30 * props.unit &&
          c.c &&
          c.c.state !== "idle" &&
          (props.craneTags === "*" || c.c.vessel === props.craneTags)
      )
      .sort((a, b) => a.p.x - b.p.x)
    // 相邻岸桥牌横向挨得太近（牌宽约 58 设计像素）会互相压住：隔一个抬高，细竖线连回岸桥顶。
    // 抬高量按左右邻居算：抬起的牌底要高过横向重叠的邻居的牌顶（牌高约 18 设计像素，再留 3 像素）
    const u = props.unit
    const W = 60 * u
    const H = 21 * u
    list.forEach((c, i) => {
      const prev = list[i - 1]
      c.up = !!prev && !prev.up && c.p.x - prev.p.x < W
    })
    list.forEach((c, i) => {
      if (!c.up) return
      let lift = 0
      for (const n of [list[i - 1], list[i + 1]])
        if (n && !n.up && Math.abs(n.p.x - c.p.x) < W)
          lift = Math.max(lift, c.p.y - n.p.y + H)
      c.lift = Math.max(0, lift)
    })
    return list
  })
  const berths = computed(() =>
    props.a ? props.a.berths.filter((b) => inView(b.p)) : []
  )
  const stale = computed(() => {
    if (!props.a) return []
    const lost = new Map(
      props.state.events
        .filter((e) => e.kind === "agvSignal" && e.status !== "resolved")
        .map((e) => [e.target, e])
    )
    return props.a.agvs
      .filter((x) => lost.has(x.id) && inView(x.p))
      .map((x) => ({
        ...x,
        // 标签默认放在车左侧；离左栏太近（放不下约 250 设计像素）时放到右侧
        right: x.p.x - 260 * props.unit < props.bounds.left,
        min: Math.max(
          1,
          Math.round((props.state.t - lost.get(x.id).at) / 60000)
        )
      }))
  })
  /**
   * 告警卡：放在锚点（故障设备顶上）的左上方，和定稿一致——卡片左边离锚点约 260、顶边高出约 235 设计像素，
   * 引线从卡片右下角连回设备；水平夹在两侧栏之间（锚点太靠左时卡片挪到右上方）
   */
  const al = computed(() => {
    const p = props.alarmAt
    if (!props.alarm || !p) return null
    const u = props.unit
    const w = 260 * u
    const lo = props.bounds.left + 12 * u
    const hi = props.bounds.right - w - 12 * u
    let x = p.x - 262 * u
    if (x < lo) x = p.x + 100 * u
    x = Math.max(lo, Math.min(hi, x))
    const y = Math.max(props.bounds.top + 10 * u, p.y - 235 * u)
    // 引线起点：卡片靠近锚点那一侧的下角；锚点被侧栏挡住（在两侧栏之外）时不画引线
    const lx = x + w / 2 < p.x ? x + w - 10 * u : x + 10 * u
    const lead = p.x > props.bounds.left && p.x < props.bounds.right
    return { x, y, lx, lead, hgt: 84 * u, ax: p.x, ay: p.y }
  })
</script>
