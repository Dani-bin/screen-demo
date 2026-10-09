<!-- 环境监测：温度、湿度、CO₂、PM2.5、TVOC、照度（六格）+ 分区温度（机房超温标橙） -->
<template>
  <section>
    <PanelTitle title="环境监测">
      <template #extra>实时</template>
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
          <b class="num">{{ env.tvoc }}</b
          ><small>mg/m³</small><span>TVOC</span>
        </div>
        <div class="cell">
          <b class="num">{{ env.lux }}</b
          ><small>lx</small><span>照度</span>
        </div>
      </div>
      <div class="zones">
        分区温度：
        <span v-for="z in env.zones" :key="z.name" :class="{ warn: z.warn }"
          >{{ z.name }} <b class="num">{{ z.temp }}°C</b></span
        >
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
  .zones {
    margin-top: 10px;
    font-size: 12px;
    color: #8aa0bd;

    span {
      margin-right: 12px;
      color: #3ddc97;

      &.warn {
        color: #ff9f43;
      }
    }

    b {
      font-weight: normal;
    }
  }
</style>
