<!-- 瓦斯抽采：地面钻孔在抽率与抽采量，下面是回风隅角 24 h 曲线 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>瓦斯抽采<small>地面钻孔抽采</small></h3>
    <div class="ring-row">
      <RingGauge :pct="d.pumping / d.wells" label="在抽率" />
      <div class="txt">
        <div>
          抽采钻孔<b class="num">{{ d.wells }}</b> 口 · 在抽<b class="num">{{
            d.pumping
          }}</b>
          口
        </div>
        <div>
          抽采纯量<b class="num">{{ d.pure.toFixed(1) }}</b> m³/min
        </div>
        <div>
          平均浓度<b class="num">{{ d.concentration.toFixed(0) }}</b> %
        </div>
        <div>
          火炬燃烧<b class="num">{{ d.flares }}</b> 台运行
        </div>
      </div>
    </div>
    <div class="cap">LW-B05 回风隅角瓦斯浓度（%）· 24 h</div>
    <T1Chart :g="g" />
  </section>
</template>

<script setup>
  import RingGauge from "./RingGauge.vue"
  import T1Chart from "./T1Chart.vue"

  defineProps({
    d: { type: Object, required: true },
    g: { type: Object, required: true },
    grow: { type: Boolean, default: false }
  })
</script>

<style lang="scss" scoped>
  .ring-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .txt {
    font-size: 13px;
    line-height: 22px;
    color: var(--sub);

    b {
      margin-left: 4px;
      font-size: 17px;
      font-weight: normal;
      color: var(--text);
    }
  }
</style>
