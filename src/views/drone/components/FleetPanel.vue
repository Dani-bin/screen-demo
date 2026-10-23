<!--
  机队状态：4 个机场各一张卡（机场状态、无人机电量、舱盖、今日架次、气象、数据质量、能否起飞及原因）。
  离线的机场卡片置灰、斜纹底、数值停在离线前；不可起飞的琥珀色。点卡片 = 选中该机场。
-->
<template>
  <section class="panel fleet">
    <div class="ph">
      <h3>机队状态</h3>
      <span class="meta">4 机场 · 4 无人机 · 在飞 {{ inAir }}</span>
    </div>
    <div class="cards">
      <div
        v-for="c in cards"
        :key="c.id"
        class="dock"
        :class="[c.cls, { sel: selected === c.id || selected === c.drone }]"
        @click="$emit('pick', c.id)"
      >
        <div class="top">
          <div class="name ttl">
            {{ c.name }}<span>{{ c.id }} · {{ c.zone }}</span>
          </div>
          <span
            class="chip"
            :style="{ color: c.color, background: tint(c.color) }"
            ><i class="dot" :style="{ background: c.color }"></i
            >{{ c.label }}</span
          >
        </div>
        <div class="row">
          <span>{{ c.drone }}</span>
          <span class="bat"
            ><i
              :style="{
                width: rem((c.battery / 100) * 42),
                background: c.batColor
              }"
            ></i
          ></span>
          <b class="num dv">{{ c.battery.toFixed(0) }}%</b>
          <span
            >舱盖 <span class="dv">{{ c.lid }}</span></span
          >
          <span v-if="c.rtk" class="amber">RTK 浮点</span>
          <span class="push"
            >今日 <b class="num dv">{{ c.sorties }}</b> 架次</span
          >
        </div>
        <div class="row">
          <span class="wx">
            风 <b class="num dv">{{ c.wind }}</b> m/s {{ c.windLevel }} 级 ·
            阵风
            <b class="num dv" :class="{ amber: c.gustHigh }">{{ c.gust }}</b> ·
            {{ c.rain }}
          </span>
          <span class="q push">{{ c.quality }}</span>
        </div>
        <span class="reason" :class="c.reasonCls">{{ c.reason }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
  import { DOCK_STATE, DRONE_STATE, RAIN_LEVEL } from "../data/catalog.js"
  import { DOCKS, ROUTES } from "../data/layout.js"
  import { hms, mmss, rem } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    selected: { type: String, default: null }
  })
  defineEmits(["pick"])

  const ZONE = {
    "DK-01": "储运",
    "DK-02": "生产",
    "DK-03": "公用工程",
    "DK-04": "物流管理"
  }
  const LID = { closed: "关", open: "开", opening: "开启中", closing: "关闭中" }
  const tint = (c) => `color-mix(in srgb, ${c} 14%, transparent)`

  const inAir = computed(
    () =>
      Object.values(props.state.drones).filter((u) => u.state !== "docked")
        .length
  )

  const cards = computed(() =>
    Object.values(props.state.docks).map((d) => {
      const u = props.state.drones[DOCKS[d.id].drone]
      const off = !d.online
      const warn = !off && !d.canFly && d.blockReason !== "无人机在外作业"
      const color = off
        ? "var(--off)"
        : d.state === "working"
          ? "var(--run)"
          : warn
            ? "var(--warn)"
            : "var(--ok)"
      let reason
      let reasonCls = "ok"
      if (off) {
        reason = `离线 ${mmss(d.age)} · 最后在线 ${hms(d.lastSeen)} · 数值为离线前`
        reasonCls = "off"
      } else if (warn) {
        const p = props.state.plan.find(
          (x) => x.dock === d.id && x.status === "postponed"
        )
        const gust =
          d.blockReason === "阵风超限"
            ? `（阵风 ${d.gust.toFixed(1)} m/s ≥ 12）`
            : ""
        reason = `不可起飞 · ${d.blockReason}${gust}${p ? ` · ${p.route} ${hms(p.plannedAt, false)} 已顺延 ${p.delayMin} min` : ""}`
        reasonCls = "warn"
      } else if (u.state !== "docked") {
        const route = u.route
          ? `${u.route} ${ROUTES[u.route].name}`
          : "复核任务"
        reason = `${route} · ${DRONE_STATE[u.state]} · ${u.progress}%`
      } else reason = "可起飞"
      return {
        id: d.id,
        drone: u.id,
        name: DOCKS[d.id].name,
        zone: ZONE[d.id],
        cls: off ? "off" : warn ? "warn" : "",
        color,
        label: off ? "离线" : DOCK_STATE[d.state],
        battery: u.battery,
        batColor:
          u.battery < 30
            ? "var(--major)"
            : u.battery < 50
              ? "var(--warn)"
              : "var(--ok)",
        lid: LID[d.lid],
        rtk: u.rtk === "float",
        sorties: d.sorties,
        wind: d.wind.toFixed(1),
        windLevel: d.windLevel,
        gust: d.gust.toFixed(1),
        gustHigh: d.gust >= 12,
        rain: RAIN_LEVEL[d.rain],
        quality: off
          ? "数据过期"
          : d.q === "uncertain"
            ? `延迟 ${d.age.toFixed(0)} s`
            : `${d.age.toFixed(0)} s 前`,
        reason,
        reasonCls
      }
    })
  )
</script>

<style lang="scss" scoped>
  .fleet {
    left: 24px;
    top: 96px;
    width: 400px;
    height: 566px;
    // 设计稿没设行高（= normal，思源黑体约 1.45 倍）；页面从 Tailwind preflight 继承了 1.5，
    // 每行多出约 0.5 px、每张卡高出几个像素，这里改回 normal 与设计稿一致
    line-height: normal;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 12px;
  }
  .dock {
    position: relative;
    padding: 10px 12px;
    background: var(--panel-2);
    border-radius: 3px;
    border-left: 3px solid var(--ok);
    cursor: pointer;
    &.warn {
      border-left-color: var(--warn);
    }
    &.off {
      border-left-color: var(--off);
      background: repeating-linear-gradient(
          135deg,
          transparent 0 8px,
          rgba(127, 127, 127, 0.06) 8px 16px
        ),
        var(--panel-2);
      .dv,
      .wx {
        opacity: 0.45;
      }
    }
    &.sel {
      outline: 1px solid var(--accent);
    }
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .name {
    font-size: 15px;
    span {
      font-family: "Source Han Sans CN", sans-serif;
      font-size: 12px;
      color: var(--sub);
      margin-left: 6px;
    }
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 7px;
    font-size: 12px;
    color: var(--sub);
    white-space: nowrap;
  }
  .push {
    margin-left: auto;
  }
  .bat {
    position: relative;
    width: 46px;
    height: 10px;
    border: 1px solid var(--sub);
    border-radius: 2px;
    i {
      position: absolute;
      left: 1px;
      top: 1px;
      bottom: 1px;
    }
  }
  // 设计稿的数值是 <b class="num dv">：保留 <b> 的加粗（DIN-Bold 再合成加粗），这里只改颜色
  .dv {
    color: var(--text);
  }
  // 行内琥珀色字（RTK 浮点、超限阵风）。不能叫 .warn：卡片本身也有 .warn 类（不可起飞），
  // 原先的 .warn { color !important } 会把整张卡（含"1# 机场"标题）染成橙色
  .amber {
    color: var(--warn) !important;
  }
  .q {
    font-size: 11px;
    color: var(--dim);
  }
  .reason {
    margin-top: 7px;
    font-size: 12px;
    padding: 3px 7px;
    border-radius: 3px;
    display: inline-block;
    &.warn {
      color: var(--warn);
      background: color-mix(in srgb, var(--warn) 14%, transparent);
    }
    &.off {
      color: var(--sub);
      background: color-mix(in srgb, var(--off) 18%, transparent);
    }
    &.ok {
      color: var(--ok);
      background: color-mix(in srgb, var(--ok) 12%, transparent);
    }
  }
</style>
