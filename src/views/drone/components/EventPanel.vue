<!--
  事件流：最新在前。待确认的重大事件置顶放大（大抓拍 + 读数 + 置信度 + 来源 + 联动 + 确认倒计时 + 三个操作）；
  其余每条一行：抓拍缩略图（可见光 / 红外，由三维截取）、等级、类型、对象、读数、处置状态、复核来源。
  点一条 = 镜头飞到事发点；操作按钮改写之后的仿真（见 store/clock.js 的 act）。
-->
<template>
  <section class="panel events">
    <div class="ph">
      <h3>事件流</h3>
      <span class="meta"
        >今日 {{ K.eventTotal }} · 待确认 <b class="alarm">{{ K.pending }}</b> ·
        处置中 {{ K.inProgress }}</span
      >
    </div>
    <div class="list">
      <template v-for="(e, i) in shown" :key="e.id">
        <div v-if="i === 0 && top" class="evt top" @click="$emit('locate', e)">
          <div
            class="th big"
            :style="thumbStyle(e)"
            :data-cam="e.cam === 'ir' ? '红外' : '可见光'"
          >
            <span v-if="e.type === 'gas'" class="ai">AI 识别 · 疑似气羽</span>
          </div>
          <div class="bd">
            <div class="l1">
              <span class="lv" :class="e.level">{{
                LEVELS[e.level].label
              }}</span>
              <span class="tp">{{ TYPES[e.type].label }}</span>
              <span class="tm num">{{ hms(e.detectedAt) }}</span>
            </div>
            <div class="l2 hi">
              {{ name(e) }}（{{ e.target }}）{{ reading(e) }}
            </div>
            <div class="l3">
              AI 置信度 <b class="num hi">{{ pct(e.conf) }}%</b> · {{ source(e)
              }}<template v-if="e.linked.length">
                · 联动 {{ linked(e) }}</template
              >
            </div>
            <div class="l3">
              <span class="st" :class="e.status">{{ STATUS[e.status] }}</span>
              <template v-if="e.status === 'pending'">
                <template v-if="e.overdue">
                  <b class="alarm">已超时 · 督办</b></template
                >
                <template v-else>
                  确认时限剩余
                  <b class="cd num">{{ mmss(remain(e)) }}</b></template
                >
              </template>
            </div>
          </div>
          <div class="acts" @click.stop>
            <span
              class="btn pri"
              :class="{ dis: !canAct(e) }"
              @click="canAct(e) && $emit('act', 'confirm', e.id)"
              >派单处置</span
            >
            <span
              class="btn"
              :class="{ dis: !canAct(e) }"
              @click="canAct(e) && $emit('act', 'review', e.id)"
              >就近派机复核</span
            >
            <span
              class="btn"
              :class="{ dis: !canAct(e) }"
              @click="canAct(e) && $emit('act', 'false', e.id)"
              >判为误报</span
            >
          </div>
        </div>
        <div
          v-else
          class="evt"
          :class="{ dim: e.status === 'false' || e.status === 'closed' }"
          @click="$emit('locate', e)"
        >
          <div
            class="th"
            :style="thumbStyle(e)"
            :data-cam="e.cam === 'ir' ? '红外' : '可见光'"
          ></div>
          <div class="bd">
            <div class="l1">
              <span class="lv" :class="e.level">{{
                LEVELS[e.level].label
              }}</span>
              <span class="tp">{{ TYPES[e.type].label }}</span>
              <span class="tm num">{{ hms(e.detectedAt, false) }}</span>
            </div>
            <div class="l2">{{ name(e) }}{{ reading(e) }}</div>
            <div class="l3">
              <span class="st" :class="e.status">{{ STATUS[e.status] }}</span>
              <b v-if="e.overdue" class="alarm"> 督办</b>
              置信度 {{ pct(e.conf) }}% · {{ source(e) }}
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup>
  import {
    EVENT_STATUS as STATUS,
    EVENT_TYPES as TYPES,
    LEVELS,
    LIMITS
  } from "../data/catalog.js"
  import { TARGETS } from "../data/layout.js"
  import { hms, mmss, pct, thousands } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    thumbs: { type: Object, default: () => ({}) },
    live: { type: Boolean, default: true },
    count: { type: Number, default: 4 }
  })
  defineEmits(["locate", "act"])

  const K = computed(() => props.state.kpi)
  // 置顶：最新一条待确认的重大事件（没有就不置顶）
  const top = computed(
    () =>
      props.state.events.find(
        (e) => e.status === "pending" && e.level === "major"
      ) || null
  )
  const shown = computed(() => {
    const rest = props.state.events.filter((e) => e !== top.value)
    return top.value
      ? [top.value, ...rest.slice(0, props.count - 1)]
      : rest.slice(0, props.count)
  })
  const name = (e) => TARGETS[e.target]?.name || e.target
  const remain = (e) =>
    LIMITS[e.level].confirm - (props.state.t - e.detectedAt) / 1000
  const canAct = (e) => props.live && e.status === "pending"
  function reading(e) {
    const r = TYPES[e.type].reading
    if (!r || e.reading == null) return ""
    if (e.type === "gas") return ` · CH₄ ${thousands(e.reading)} ppm·m`
    if (e.type === "temp")
      return ` · ${e.reading < 0 ? "冷点 " : "温差 +"}${e.reading} ℃`
    return ` · ${r.name} ${e.reading} ${r.unit}`
  }
  function source(e) {
    if (!e.review) return e.drone
    if (e.review.self) return `${e.drone} 原地监视中`
    if (e.review.none) return "无可用无人机"
    return `复核 ${e.review.drone}`
  }
  const linked = (e) =>
    e.linked.map((x) => (TARGETS[x]?.name || x).split(" ")[0]).join("、")
  const thumbStyle = (e) =>
    props.thumbs[e.id] ? { backgroundImage: `url(${props.thumbs[e.id]})` } : {}
</script>

<style lang="scss" scoped>
  .events {
    left: 1496px;
    top: 96px;
    width: 400px;
    height: 586px;
    // 行高回到 normal（设计稿未设行高；页面从 Tailwind preflight 继承的 1.5 让每条事件高出几个像素）
    line-height: normal;
  }
  .list {
    padding: 0 6px;
  }
  // 待确认数等红字：设计稿是 <b>，保留加粗
  .alarm {
    color: var(--major);
  }
  .hi {
    color: var(--text) !important;
  }
  .evt {
    display: flex;
    gap: 10px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    &.dim {
      opacity: 0.55;
    }
    &.top {
      flex-direction: column;
      // 与设计稿一致开 wrap：多行 flex 容器里横向拉伸以"行"的宽度为准（= 370px 的大抓拍），
      // 正文区因此和抓拍等宽，右上角的时刻才对得上设计稿（不开 wrap 时正文只有内容宽 363px）
      flex-wrap: wrap;
      gap: 6px;
      background: color-mix(in srgb, var(--major) 12%, transparent);
      border-left: 3px solid var(--major);
      .tp {
        font-size: 16px;
      }
    }
  }
  .th {
    flex: none;
    width: 84px;
    height: 56px;
    border-radius: 2px;
    // 抓拍未就绪时只留一层极淡的底（设计稿缩略图下面没有底色，深色占位块会显得像一块黑洞）
    background: rgba(120, 170, 230, 0.04) center / cover no-repeat;
    position: relative;
    overflow: hidden;
    &.big {
      width: 370px;
      height: 112px;
    }
    &::after {
      content: attr(data-cam);
      position: absolute;
      right: 2px;
      bottom: 2px;
      font-size: 10px;
      padding: 0 3px;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      border-radius: 2px;
    }
    .ai {
      position: absolute;
      left: 46%;
      top: 22%;
      width: 34%;
      height: 50%;
      border: 2px solid #ff4d4f;
      color: #fff;
      font-size: 10px;
      padding: 1px 3px;
      line-height: 1.2;
    }
  }
  .bd {
    flex: 1;
    min-width: 0;
  }
  .l1 {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tp {
    font-size: 14px;
    color: var(--text);
  }
  .tm {
    margin-left: auto;
    font-size: 12px;
    color: var(--sub);
  }
  .l2,
  .l3 {
    font-size: 12px;
    color: var(--sub);
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cd {
    color: var(--major);
    font-weight: normal;
  }
  .acts {
    display: flex;
    gap: 8px;
    width: 100%;
    margin-top: 2px;
  }
  .btn {
    flex: 1;
    height: 28px;
    line-height: 28px;
    text-align: center;
    font-size: 13px;
    border-radius: 3px;
    border: 1px solid var(--line);
    color: var(--text);
    cursor: pointer;
    &.pri {
      background: var(--major);
      border-color: var(--major);
      color: #fff;
    }
    &.dis {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
</style>
