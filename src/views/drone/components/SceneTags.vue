<!--
  场景标签：绑定三维位置，每帧随镜头投影到画面上（scene.project）。
    - 机场：六边形标 + 名称牌（离线虚线框灰字 / 不可起飞琥珀框 / 作业中青点）
    - 无人机：四旋翼图标（监视重大事件时红色，其余青色）+ 编号 · 相对高度 · 电量 · 当前任务段
      （RTK 浮点时换成琥珀色"RTK 浮点"），靠画面左缘的朝右展开；非告警的在飞无人机画一条到地面的竖直虚线
    - 重大事件：等级 + 类型 + 确认倒计时，放在光柱右侧
    - 片区名（只在主机位显示）
  全景下真实模型不到 1 像素，这些放大的符号就是设备在画面上的"样子"（定稿冲突 4）。
-->
<template>
  <div class="tags">
    <!-- 无人机到地面的竖直虚线（坐标是设计稿 px，viewBox 与整屏一致） -->
    <svg class="drops" viewBox="0 0 1920 1080" preserveAspectRatio="none">
      <line
        v-for="l in drops"
        :key="l.key"
        :x1="l.x1"
        :y1="l.y1"
        :x2="l.x2"
        :y2="l.y2"
      />
    </svg>
    <div
      v-for="t in tags"
      :key="t.key"
      class="tag"
      :class="[t.cls, { right: t.right }]"
      :style="t.style"
      @click.stop="$emit('pick', t.pick)"
    >
      <div class="box" v-html="t.html"></div>
      <div class="stem" :style="{ height: rem(t.stem) }"></div>
      <i v-if="t.icon" class="icon" :class="t.icon"></i>
    </div>
    <template v-if="zones">
      <div v-for="z in zoneTags" :key="z.name" class="zone" :style="z.style">
        {{ z.name }}
      </div>
    </template>
  </div>
</template>

<script setup>
  import { EVENT_TYPES, LIMITS } from "../data/catalog.js"
  import { DOCKS, TARGETS, ZONES } from "../data/layout.js"
  import { mmss, rem } from "../utils.js"

  /** 无人机标签上的任务段：周界类目标"周界围网西段" → "西段周界"（和航线名"北段 · 西段周界"的写法一致） */
  function taskLabel(u) {
    const tg = TARGETS[u.targets?.[0]]
    if (!tg) return ""
    return tg.kind === "perimeter"
      ? `${tg.name.replace("周界围网", "")}周界`
      : tg.name
  }

  const props = defineProps({
    scene: { type: Object, required: true },
    state: { type: Object, required: true },
    zones: { type: Boolean, default: true }
  })
  defineEmits(["pick"])

  const tags = shallowRef([])
  const zoneTags = shallowRef([])
  const drops = shallowRef([])
  let raf = 0

  const pos = (p, extra = {}) => ({ left: rem(p.x), top: rem(p.y), ...extra })

  function frame() {
    raf = requestAnimationFrame(frame)
    const sc = props.scene
    const st = props.state
    if (!sc.poses || !st) return
    const out = []
    for (const [id, d] of Object.entries(st.docks)) {
      const k = DOCKS[id]
      const p = sc.project(k.x, k.y, k.roof + 1)
      if (!p.visible) continue
      const u = st.drones[k.drone]
      let cls = ""
      let html
      if (!d.online) {
        cls = "off"
        html = `<i class="dot" style="background:var(--off)"></i><b>${k.name}</b>离线 ${mmss(d.age)}`
      } else if (!d.canFly && d.blockReason !== "无人机在外作业") {
        cls = "warn"
        const extra =
          d.blockReason === "阵风超限" ? ` · 阵风 ${d.gust.toFixed(1)}` : ""
        html = `<i class="dot" style="background:var(--warn)"></i><b>${k.name}</b><span style="color:var(--warn)">不可起飞${extra}</span>`
      } else
        html = `<i class="dot" style="background:var(--run)"></i><b>${k.name}</b>${u.state === "docked" ? "待命" : "作业中"}`
      out.push({
        key: id,
        pick: id,
        cls,
        html,
        style: pos(p),
        // 引线长度照定稿方向 A：离线 64 px（牌子抬高、避开下方的告警标签）、不可起飞 26 px、正常 18 px
        stem: cls === "off" ? 64 : cls === "warn" ? 26 : 18,
        icon: `hex ${cls}`
      })
    }
    const lines = []
    for (const [id, u] of Object.entries(st.drones)) {
      if (u.state === "docked") continue
      const pose = sc.poses[u.dock]?.drone
      if (!pose) continue
      const p = sc.project(pose.x, pose.y, pose.z)
      if (!p.visible) continue
      // 正在监视重大事件：图标标红（定稿里 UAV-02 是红色四旋翼，下面接三维的红色视野锥）
      const alarmed =
        u.state === "monitor" &&
        st.events.some((e) => e.id === u.eventId && e.level === "major")
      const extra =
        u.rtk === "float"
          ? `<span style="color:var(--warn)">RTK 浮点</span>`
          : `<span>${taskLabel(u)}</span>`
      out.push({
        key: id,
        pick: id,
        html: `<b>${id}</b><span class="num">${(pose.z - DOCKS[u.dock].roof).toFixed(0)} m · ${u.battery.toFixed(0)}%</span>${extra}`,
        style: pos(p),
        stem: 22,
        right: p.x < 560,
        icon: alarmed ? "quad alarm" : "quad"
      })
      if (!alarmed) {
        const g = sc.project(pose.x, pose.y, 0)
        if (g.visible)
          lines.push({ key: id, x1: p.x, y1: p.y, x2: g.x, y2: g.y })
      }
    }
    drops.value = lines
    const alarm = st.events.find(
      (e) => e.status === "pending" && e.level === "major"
    )
    if (alarm) {
      const p = sc.project(alarm.x, alarm.y, 30)
      if (p.visible) {
        const remain =
          LIMITS[alarm.level].confirm - (st.t - alarm.detectedAt) / 1000
        out.push({
          key: alarm.id,
          pick: alarm.target,
          cls: "alarm",
          html: `<span class="lv major">重大</span><b>${EVENT_TYPES[alarm.type].label}</b><span class="num">${alarm.overdue ? "督办" : mmss(remain)}</span>`,
          style: pos({ x: p.x + 18, y: p.y }),
          stem: 0,
          right: true
        })
      }
    }
    tags.value = out
    if (props.zones)
      zoneTags.value = Object.values(ZONES).map((z) => {
        const [x0, y0, x1] = z.rect
        // 有定稿反推的锚点就用它，否则放在片区南边中点
        const [lx, ly] = z.label || [(x0 + x1) / 2, y0 + 20]
        const p = sc.project(lx, ly, 0)
        return { name: z.name, style: pos(p) }
      })
  }
  onMounted(() => (raf = requestAnimationFrame(frame)))
  onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<style lang="scss" scoped>
  .tags {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
    overflow: hidden;
  }
  .tag {
    position: absolute;
    transform: translate(-50%, -100%);
    white-space: nowrap;
    font-size: 12px;
    line-height: 1;
    pointer-events: auto;
    cursor: pointer;
    &.right {
      transform: translate(-14px, -100%);
      .stem {
        margin: 0 0 0 14px;
      }
    }
    :deep(.box) {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: 3px;
      background: rgba(6, 12, 24, 0.82);
      border: 1px solid rgba(120, 170, 230, 0.3);
      color: #e3ecf8;
      b {
        font-weight: normal;
        font-family: "Alimama ShuHeiTi", sans-serif;
        font-size: 13px;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        display: inline-block;
      }
      .lv {
        font-size: 11px;
        padding: 0 5px;
        line-height: 18px;
        border-radius: 2px;
        background: var(--major);
        color: #fff;
      }
    }
    &.warn :deep(.box) {
      border-color: var(--warn);
    }
    &.off :deep(.box) {
      opacity: 0.85;
      border-style: dashed;
      border-color: var(--off);
      color: var(--sub);
    }
    &.alarm :deep(.box) {
      border-color: var(--major);
      background: rgba(60, 8, 10, 0.86);
    }
  }
  .drops {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    line {
      stroke: #36e3d8;
      stroke-width: 1;
      stroke-dasharray: 2 2;
      opacity: 0.8;
    }
  }
  .stem {
    width: 1px;
    margin: 0 auto;
    background: currentColor;
    color: #9fb6d6;
    opacity: 0.6;
  }
  .icon {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translate(-50%, 50%);
    &.hex {
      width: 14px;
      height: 9px;
      background: var(--ok);
      clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
      &.warn {
        background: var(--warn);
      }
      &.off {
        background: var(--off);
      }
    }
    // 四旋翼符号，照定稿 drafts.html 的 quad()：半透明光圈 + X 形机臂 + 4 个旋翼圈 + 中心点
    &.quad {
      width: 32px;
      height: 32px;
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-16 -16 32 32'%3E%3Ccircle r='15.4' fill='%2336e3d8' fill-opacity='.18'/%3E%3Cg fill='none' stroke='%2336e3d8'%3E%3Cpath d='M-7-7L7 7M-7 7L7-7' stroke-width='2'/%3E%3Cg stroke-width='1.5'%3E%3Ccircle cx='-7' cy='-7' r='3'/%3E%3Ccircle cx='7' cy='-7' r='3'/%3E%3Ccircle cx='-7' cy='7' r='3'/%3E%3Ccircle cx='7' cy='7' r='3'/%3E%3C/g%3E%3C/g%3E%3Ccircle r='2.5' fill='%2336e3d8'/%3E%3C/svg%3E")
        center / 100% 100% no-repeat;
      &.alarm {
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-16 -16 32 32'%3E%3Ccircle r='15.4' fill='%23ff6b6b' fill-opacity='.18'/%3E%3Cg fill='none' stroke='%23ff6b6b'%3E%3Cpath d='M-7-7L7 7M-7 7L7-7' stroke-width='2'/%3E%3Cg stroke-width='1.5'%3E%3Ccircle cx='-7' cy='-7' r='3'/%3E%3Ccircle cx='7' cy='-7' r='3'/%3E%3Ccircle cx='-7' cy='7' r='3'/%3E%3Ccircle cx='7' cy='7' r='3'/%3E%3C/g%3E%3C/g%3E%3Ccircle r='2.5' fill='%23ff6b6b'/%3E%3C/svg%3E");
      }
    }
  }
  .right .icon {
    left: 14px;
  }
  .zone {
    position: absolute;
    transform: translate(-50%, 0);
    letter-spacing: 4px;
    color: rgba(200, 220, 255, 0.5);
    font-size: 12px;
    white-space: nowrap;
  }
</style>
