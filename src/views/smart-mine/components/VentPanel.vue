<!-- 通风系统：抽出式，Deer Creek 回风井主扇 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>通风系统<small>抽出式 · 主扇 2 台（1 用 1 备）</small></h3>
    <BarRow
      k="总进风量"
      :v="fmt(v.intake)"
      unit="m³/min"
      :pct="v.intake / 150"
      color="#4c9dff"
    />
    <BarRow
      k="总回风量"
      :v="fmt(v.ret)"
      unit="m³/min"
      :pct="v.ret / 150"
      color="#ff7a6a"
    />
    <BarRow
      k="主扇负压"
      :v="v.pressure.toFixed(2)"
      unit="kPa"
      :pct="v.pressure * 20"
      color="#36e0ff"
    />
    <BarRow
      k="工作面风量"
      :v="fmt(v.faceAir)"
      unit="m³/min"
      :pct="v.faceAir / 40"
      color="#3ddc97"
    />
    <BarRow
      k="有效风量率"
      :v="v.effective.toFixed(1)"
      unit="%"
      :pct="v.effective"
      color="#3ddc97"
    />
  </section>
</template>

<script setup>
  import BarRow from "./BarRow.vue"
  import { fmt } from "../utils"

  defineProps({
    v: { type: Object, required: true },
    grow: { type: Boolean, default: false }
  })
</script>
