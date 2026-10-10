<!-- 环境实时：温度、湿度、CO₂、PM2.5、照度、噪声 + 联动策略 -->
<template>
  <section>
    <PanelTitle title="环境实时">
      <template #extra>30 秒刷新</template>
    </PanelTitle>
    <div class="body">
      <div class="cells">
        <div class="cell">
          <b class="num">{{ env.temp }}</b
          ><small>°C</small><span>温度</span>
        </div>
        <div class="cell">
          <b class="num">{{ env.humidity }}</b
          ><small>%RH</small><span>湿度</span>
        </div>
        <div class="cell green">
          <b class="num">{{ env.co2 }}</b
          ><small>ppm</small><span>CO₂</span>
        </div>
        <div class="cell green">
          <b class="num">{{ env.pm25 }}</b
          ><small>μg/m³</small><span>PM2.5</span>
        </div>
        <div class="cell">
          <b class="num">{{ env.lux }}</b
          ><small>lx</small><span>照度</span>
        </div>
        <div class="cell">
          <b class="num">{{ env.noise }}</b
          ><small>dB</small><span>噪声</span>
        </div>
      </div>
      <div class="policy">
        联动策略：<em>会议开始前 15 分钟预冷</em> ·
        <em>无人 10 分钟自动关灯</em>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  defineProps({
    env: { type: Object, required: true }
  })
</script>

<style lang="scss" scoped>
  .policy {
    margin-top: 10px;
    font-size: 12px;
    color: #8aa0bd;

    em {
      font-style: normal;
      color: #2de2e6;
    }
  }
</style>
