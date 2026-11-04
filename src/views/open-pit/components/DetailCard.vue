<!--
  选中详情卡：点单车 / 电铲 / 事件 / 三维里的对象后出现（设计稿 #c-detail 的移植，设计时刻默认选中 TK-037）
  内容由 board.detail 派生（卡车：编组、状态、原因或动作、电量、今日趟数；电铲、雷达、基站、卸载点等各有自己的几行）
  点「✕ 关闭」取消选中（同时通知场景）
-->
<template>
  <section v-if="d" class="card c-detail" :style="{ borderColor: color }">
    <h3 style="margin-bottom: 6px">
      <i :style="{ color: badge, borderColor: badge }">已选</i>{{ d.title
      }}<em class="close" @click="select(null)">✕ 关闭</em>
    </h3>
    <div
      style="
        display: grid;
        grid-template-columns: 54px 1fr;
        gap: 2px 8px;
        font-size: 13px;
      "
    >
      <template v-for="r in rows" :key="r.k">
        <span class="mute">{{ r.k }}</span>
        <span
          v-if="r.bar != null"
          style="display: flex; align-items: center; gap: 8px"
          ><span class="bar"
            ><i
              :style="{
                width: r.bar + '%',
                background: r.barColor || 'var(--c-run)'
              }"
            ></i></span
          ><span class="num" style="width: 36px; text-align: right">{{
            r.v
          }}</span></span
        >
        <span v-else :style="{ color: r.color || '' }"
          ><b
            v-if="r.sq"
            style="
              display: inline-block;
              width: 8px;
              height: 8px;
              margin-right: 6px;
            "
            :style="{ background: r.sq }"
          ></b
          >{{ r.v }}<span v-if="r.sub" class="dim"> · {{ r.sub }}</span></span
        >
      </template>
    </div>
  </section>
</template>

<script setup>
  const { detail: d, select } = inject("board")
  // 边框与「已选」徽标：故障红、预警橙，其余用青色细线
  const TONE = { fault: "var(--fault)", warn: "var(--warn)" }
  const color = computed(() => TONE[d.value?.tone] || "var(--line-strong)")
  const badge = computed(() => TONE[d.value?.tone] || "var(--neon-cyan)")
  // 非卡车对象（电铲、雷达、基站……）第一行加上设备名称
  const rows = computed(() =>
    d.value.sub
      ? [{ k: "名称", v: d.value.sub }, ...d.value.rows]
      : d.value.rows
  )
</script>
