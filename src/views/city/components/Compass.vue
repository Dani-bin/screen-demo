<!--
  指北针 + 比例尺
  heading 为视线方位角（0 朝北、顺时针为正），指针反向旋转即始终指向北。
  "N" 字与指针放在同一个旋转层里一起转，避免 "N" 固定在上方而指针指向别处。
-->
<template>
  <div class="compass-wrap">
    <div class="compass">
      <div class="needle" :style="{ transform: `rotate(${-heading}deg)` }">
        <span>N</span>
        <i></i>
      </div>
    </div>
    <div class="scale-bar">{{ scaleMeters.toLocaleString() }} m</div>
  </div>
</template>

<script setup>
  defineProps({
    heading: { type: Number, default: 0 },
    scaleMeters: { type: Number, default: 0 }
  })
</script>

<style lang="scss" scoped>
  .compass-wrap {
    position: absolute;
    right: 28px;
    bottom: 26px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }

  .compass {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--city-panel);
    box-shadow: 0 8px 28px rgba(31, 45, 58, 0.14);

    /* 旋转层与表盘同大，默认以表盘中心为旋转原点 */
    .needle {
      position: absolute;
      inset: 0;
    }

    span {
      position: absolute;
      top: 6px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 11px;
      font-weight: 700;
      color: var(--city-ink);
    }

    /* 三角指针：尖端朝上（未旋转时指向 "N"）；页面启用了 border-box，宽高由边框撑出 */
    i {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 0;
      height: 0;
      margin: -14px 0 0 -6px;
      /* 底宽 12px、高 22px 的细长三角，朝向一眼可辨（过宽会接近正三角，看不出指向） */
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 22px solid var(--city-teal);
    }
  }

  .scale-bar {
    position: relative;
    min-width: 100px;
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--city-panel);
    font-size: 12px;
    text-align: center;
    color: var(--city-ink-soft);
    font-variant-numeric: tabular-nums;

    /* 100px 长的刻度线，与 scaleMeters 的口径一致 */
    &::before {
      content: "";
      position: absolute;
      left: 50%;
      bottom: 2px;
      width: 100px;
      height: 2px;
      margin-left: -50px;
      background: var(--city-ink-soft);
    }
  }
</style>
