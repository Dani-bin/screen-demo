<!--
  右栏：导视牌式的当前提示（进度、剩余时间、下一步）、全程汇总、推荐 / 无障碍切换、分步提示
  当前步跟随三维里人员的进度；点某一步可以让人员从那一步开始走。
-->
<template>
  <aside class="guide-panel">
    <section class="sign">
      <NavIcon :name="stepIcon(current)" class="big-ic" />
      <div class="next">
        <span>下一步</span>
        <b>{{ nextText }}</b>
      </div>
      <h2>
        <span v-for="(ln, i) in headLines" :key="i">{{ ln }}</span>
      </h2>
      <p class="note">{{ splitNote(current.text)[1] }}</p>
      <p class="left">{{ arrived ? "已到达" : `剩余约 ${remain} 分钟` }}</p>
      <div class="bar">
        <i :style="{ width: `${Math.max(frac, 0.02) * 100}%` }"></i>
      </div>
    </section>

    <section class="stats">
      <div v-for="s in stats" :key="s.label">
        <p>
          <b>{{ s.value }}</b>
          <span>{{ s.unit }}</span>
        </p>
        <small>{{ s.label }}</small>
      </div>
    </section>

    <nav class="mode">
      <button
        :class="{ on: mode === 'recommend' }"
        @click="emit('mode', 'recommend')"
      >
        推荐路线
      </button>
      <button
        :class="{ on: mode === 'accessible' }"
        @click="emit('mode', 'accessible')"
      >
        无障碍 · 只乘电梯
      </button>
    </nav>

    <ol class="steps">
      <li
        v-for="(s, i) in route.steps"
        :key="i"
        :class="{ done: i < stepIndex, on: i === stepIndex }"
        @click="emit('jump', i)"
      >
        <NavIcon :name="stepIcon(s)" class="ic" />
        <span class="fl">{{ FLOORS[s.floor] }}</span>
        <span class="txt">
          {{ splitNote(s.text)[0] }}
          <em v-if="splitNote(s.text)[1]">（{{ splitNote(s.text)[1] }}）</em>
        </span>
      </li>
    </ol>
  </aside>
</template>

<script setup>
  import NavIcon from "./NavIcon.vue"
  import { FLOORS } from "../route"
  import { minutes, splitNote, stepIcon } from "../utils"

  const props = defineProps({
    route: { type: Object, required: true },
    stepIndex: { type: Number, default: 0 },
    frac: { type: Number, default: 0 },
    arrived: { type: Boolean, default: false },
    mode: { type: String, default: "recommend" }
  })
  const emit = defineEmits(["mode", "jump"])

  const current = computed(
    () => props.route.steps[props.stepIndex] || props.route.steps[0]
  )
  // 导视牌主句：长句在逗号处断成两行（上一行是动作"左转，"，下一行是怎么走），不在词中间断开
  const headLines = computed(() => {
    const t = splitNote(current.value.text)[0]
    // 到达：「到达 核磁共振室（309），在右手边」→「到达 核磁共振室」/「309 · 在右手边」
    const m = t.match(/^到达 (.+?)（(.+?)），(.+)$/)
    if (m) return [`到达 ${m[1]}`, `${m[2]} · ${m[3]}`]
    const i = t.indexOf("，")
    return t.length > 11 && i > 0 ? [t.slice(0, i + 1), t.slice(i + 1)] : [t]
  })
  const nextText = computed(() => {
    const n = props.route.steps[props.stepIndex + 1]
    if (!n) return "到达终点"
    // 只取第一个短句（"左转，沿南走廊直行 33 米" → "左转"）
    return splitNote(n.text)[0].split("，")[0]
  })
  // 剩余真实用时：按路网代价（秒）× 剩余比例
  const remain = computed(() => minutes(props.route.cost * (1 - props.frac)))
  const stats = computed(() => {
    const r = props.route
    // 第三项：本条路线用到的竖向交通
    let third = { value: 0, unit: "段", label: "乘扶梯" }
    if (r.elevators) third = { value: r.elevators, unit: "次", label: "乘电梯" }
    else if (r.escalators)
      third = { value: r.escalators, unit: "段", label: "乘扶梯" }
    else if (r.stairs) third = { value: r.stairs, unit: "层", label: "走楼梯" }
    else third = { value: 0, unit: "次", label: "换楼层" }
    return [
      { value: Math.round(r.length), unit: "米", label: "全程步行" },
      { value: minutes(r.cost), unit: "分钟", label: "预计用时" },
      third
    ]
  })
</script>

<style lang="scss" scoped>
  .guide-panel {
    position: absolute;
    right: 40px;
    top: 92px;
    width: 360px;
    bottom: 40px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .sign {
    position: relative;
    height: 236px;
    padding: 24px;
    background: var(--sign);
    color: var(--sign-ink);
    .big-ic {
      font-size: 56px;
      --icon-hole: var(--sign);
    }
    .next {
      position: absolute;
      right: 24px;
      top: 24px;
      text-align: right;
      span {
        display: block;
        font-size: 14px;
        color: var(--sign-sub);
      }
      b {
        display: block;
        margin-top: 4px;
        font-size: 16px;
        font-weight: normal;
      }
    }
    h2 {
      margin-top: 14px;
      font-family: "Alimama ShuHeiTi";
      font-size: 27px;
      line-height: 1.22;
      span {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
    .note {
      margin-top: 4px;
      font-size: 16px;
      color: var(--sign-sub);
    }
    .left {
      position: absolute;
      right: 24px;
      bottom: 30px;
      font-size: 14px;
      color: var(--sign-sub);
    }
    .bar {
      position: absolute;
      left: 24px;
      right: 24px;
      bottom: 18px;
      height: 6px;
      background: var(--sign-sub);
      i {
        display: block;
        height: 100%;
        background: var(--sign-ink);
        transition: width 0.3s linear;
      }
    }
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    height: 88px;
    padding: 14px 24px;
    background: var(--panel);
    p {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }
    b {
      font-family: "DIN";
      font-size: 34px;
      line-height: 1.1;
    }
    span {
      font-size: 15px;
    }
    small {
      font-size: 14px;
      color: var(--sub);
    }
  }
  .mode {
    display: flex;
    button {
      flex: 1;
      height: 48px;
      background: var(--panel);
      color: var(--sub);
      font-size: 16px;
      transition:
        background 0.2s,
        color 0.2s;
      &.on {
        background: var(--ink);
        color: var(--ground);
      }
    }
  }
  .steps {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 0;
    background: var(--panel);
    list-style: none;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
    li {
      position: relative;
      display: grid;
      grid-template-columns: 22px 38px 1fr;
      column-gap: 12px;
      align-items: start;
      padding: 10px 20px;
      cursor: pointer;
      transition:
        background 0.2s,
        color 0.2s;
      &:hover {
        background: var(--panel2);
      }
      &.done {
        color: var(--faint);
        .ic {
          color: var(--faint);
        }
      }
      &.on {
        background: var(--route-tint);
        &::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background: var(--route);
        }
        .ic {
          color: var(--route);
          --icon-hole: var(--route-tint);
        }
      }
    }
    .ic {
      margin-top: 1px;
      font-size: 22px;
      color: var(--sub);
      --icon-hole: var(--panel);
    }
    .fl {
      height: 24px;
      line-height: 24px;
      text-align: center;
      background: var(--tag);
      color: var(--sub);
      font-family: "DIN";
      font-size: 14px;
    }
    .txt {
      font-size: 16px;
      line-height: 24px;
      em {
        font-style: normal;
        display: block;
      }
    }
  }
</style>
