<!-- 告警事件：今日已发生的，最新在上 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>
      告警事件<small
        >今日 <b>{{ alarms.length }}</b> 条 · 未闭环 <b>{{ open }}</b></small
      >
    </h3>
    <TransitionGroup name="ev" tag="ul" class="events">
      <li v-for="a in alarms.slice(0, 6)" :key="a.time + a.text">
        <time class="num">{{ a.time }}</time>
        <i :style="{ background: STATUS[a.lv].c }"></i>
        <p>{{ a.text }}</p>
        <em :class="{ hot: OPEN.includes(a.state) }">{{ a.state }}</em>
      </li>
    </TransitionGroup>
    <div v-if="!alarms.length" class="empty">今日暂无告警</div>
  </section>
</template>

<script setup>
  import { STATUS } from "../utils"

  const props = defineProps({
    alarms: { type: Array, required: true },
    grow: { type: Boolean, default: false }
  })
  /** 未闭环的处置状态 */
  const OPEN = ["处置中", "已通知", "进行中"]
  const open = computed(
    () => props.alarms.filter((a) => OPEN.includes(a.state)).length
  )
</script>

<style lang="scss" scoped>
  .events {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 14px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px dashed rgba(120, 170, 230, 0.16);
  }

  time {
    flex: none;
    width: 44px;
    color: var(--sub);
  }

  i {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  p {
    flex: 1;
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  em {
    flex: none;
    font-size: 12px;
    font-style: normal;
    color: var(--sub);

    &.hot {
      color: #ffcf3a;
    }
  }

  .empty {
    padding: 20px 0;
    text-align: center;
    color: var(--sub);
  }

  .ev-enter-active {
    transition: all 0.5s;
  }

  .ev-enter-from {
    opacity: 0;
    transform: translateX(-20px);
  }
</style>
