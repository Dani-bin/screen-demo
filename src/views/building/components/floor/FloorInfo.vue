<!-- 楼层信息：使用面积、房间、工位、在岗、工位使用率、温度均值（六格指标） -->
<template>
  <section>
    <PanelTitle title="楼层信息">
      <template #extra>{{ floor.key }} · {{ floor.name }}</template>
    </PanelTitle>
    <div class="body">
      <div class="cells">
        <div class="cell">
          <b class="num">{{ stats.area.toLocaleString("en-US") }}</b
          ><small>m²</small>
          <span>使用面积</span>
        </div>
        <div class="cell">
          <b class="num">{{ stats.rooms }}</b
          ><small>间</small>
          <span>房间</span>
        </div>
        <div class="cell">
          <b class="num">{{ stats.desks }}</b
          ><small>个</small>
          <span>工位</span>
        </div>
        <div class="cell cyan">
          <b class="num">{{ stats.staff }}</b
          ><small>人</small>
          <span>在岗</span>
        </div>
        <div class="cell green">
          <b class="num">{{ stats.deskRate }}</b
          ><small>%</small>
          <span>工位使用</span>
        </div>
        <div class="cell">
          <b class="num">{{ stats.avgTemp }}</b
          ><small>°C</small>
          <span>温度均值</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  defineProps({
    floor: { type: Object, required: true },
    stats: { type: Object, required: true }
  })
</script>
