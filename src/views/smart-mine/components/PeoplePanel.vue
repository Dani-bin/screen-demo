<!-- 人员定位：井下各区域人数 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>
      人员定位<small
        >井下 <b>{{ p.total }}</b> 人 · 带班 <b>1</b> 人</small
      >
    </h3>
    <BarRow
      v-for="([k, n], i) in p.areas"
      :key="k"
      :k="k"
      :v="n"
      unit="人"
      :pct="n * 5"
      :color="COLORS[i]"
    />
  </section>
</template>

<script setup>
  import BarRow from "./BarRow.vue"

  defineProps({
    p: { type: Object, required: true },
    grow: { type: Boolean, default: false }
  })
  const COLORS = ["#ff9a3d", "#4c9dff", "#36e0ff", "#b8aef0", "#8ea6c8"]
</script>
