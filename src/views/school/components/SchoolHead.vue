<!--
  学校大屏顶部标题栏：校名、副标题、巡览状态与时钟
-->
<template>
  <header class="school-head">
    <div class="head-brand">
      <h1 class="brand-name">{{ info.name }}</h1>
      <span class="brand-sub">{{ info.subTitle }}</span>
    </div>
    <div class="head-right">
      <div class="tour-state">
        <i class="state-dot" :class="{ paused: !playing }"></i>
        <span>{{ playing ? "自动巡览中" : "已接管 · 空闲后恢复" }}</span>
      </div>
      <time class="head-clock">{{ clockText }}</time>
    </div>
  </header>
</template>

<script setup>
  defineProps({
    info: { type: Object, required: true },
    playing: { type: Boolean, default: true }
  })

  const clockText = ref("--:--:--")
  let timer = null

  /** 每秒刷新一次时钟 */
  const tick = () => {
    const now = new Date()
    clockText.value = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((v) => String(v).padStart(2, "0"))
      .join(":")
  }

  onMounted(() => {
    tick()
    timer = setInterval(tick, 1000)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })
</script>

<style lang="scss" scoped>
  .school-head {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 76px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 32px;
    z-index: 5;
    background: linear-gradient(
      180deg,
      rgba(255, 253, 249, 0.94) 0%,
      rgba(255, 253, 249, 0.72) 70%,
      rgba(255, 253, 249, 0) 100%
    );
  }

  .head-brand {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }

  .brand-name {
    margin: 0;
    font-size: 30px;
    font-weight: 700;
    letter-spacing: 2px;
    color: var(--school-brick-deep);
  }

  .brand-sub {
    font-size: 16px;
    letter-spacing: 3px;
    color: var(--school-ink-soft);
  }

  .head-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .tour-state {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--school-ink-soft);
  }

  .state-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--school-brick);
    box-shadow: 0 0 0 4px rgba(166, 80, 60, 0.15);

    &.paused {
      background: var(--school-ink-faint);
      box-shadow: 0 0 0 4px rgba(138, 146, 155, 0.15);
    }
  }

  .head-clock {
    font-size: 22px;
    letter-spacing: 1px;
    color: var(--school-ink);
    font-variant-numeric: tabular-nums;
  }
</style>
