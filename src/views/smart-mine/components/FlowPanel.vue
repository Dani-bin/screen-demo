<!-- 煤流运输：工作面 → 主运皮带 → 选煤厂 → 装车站，下面是各堆场库存 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>
      煤流运输<small>{{ f.face > 200 ? "实时" : "夜班检修 · 停止割煤" }}</small>
    </h3>
    <div class="flow">
      <template v-for="(n, i) in nodes" :key="n.k">
        <div v-if="i" class="arrow" :class="{ off: !n.on }"></div>
        <div class="node">
          <div class="ic">{{ n.k }}</div>
          <b class="num">{{ n.v }}</b
          ><span>{{ n.u }}</span>
        </div>
      </template>
    </div>
    <BarRow
      k="原煤堆场"
      :v="f.rawPile.toFixed(1)"
      unit="万 t"
      :pct="f.rawPile * 16.7"
      color="#36e0ff"
    />
    <BarRow
      k="精煤堆场"
      :v="f.cleanPile.toFixed(1)"
      unit="万 t"
      :pct="f.cleanPile * 16.7"
      color="#4c9dff"
    />
    <BarRow
      k="矸石场库容"
      :v="f.refuseLeft"
      unit="% 剩余"
      :pct="f.refuseLeft"
      color="#b8aef0"
    />
    <BarRow
      k="今日装车"
      :v="fmt(f.loaded)"
      unit="t"
      :pct="f.loaded / 220"
      color="#3ddc97"
    />
  </section>
</template>

<script setup>
  import BarRow from "./BarRow.vue"
  import { fmt } from "../utils"

  const props = defineProps({
    f: { type: Object, required: true },
    grow: { type: Boolean, default: false }
  })
  // 箭头：上游有煤流时虚线流动，停产时变暗
  const nodes = computed(() => [
    { k: "综采", v: fmt(props.f.face), u: "t/h", on: true },
    { k: "皮带", v: fmt(props.f.belt), u: "t/h", on: props.f.face > 200 },
    { k: "洗选", v: fmt(props.f.wash), u: "t/h", on: props.f.belt > 200 },
    { k: "装车", v: props.f.trains, u: "列 / 今日", on: props.f.trains > 0 }
  ])
</script>

<style lang="scss" scoped>
  .flow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 4px 0 10px;
  }

  .node {
    width: 76px;
    text-align: center;

    .ic {
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      margin: 0 auto 4px;
      border: 1px solid rgba(54, 224, 255, 0.5);
      border-radius: 50%;
      font-size: 13px;
      color: var(--cyan);
      background: radial-gradient(
        circle,
        rgba(54, 224, 255, 0.22),
        rgba(54, 224, 255, 0.02)
      );
      box-shadow: 0 0 12px rgba(54, 224, 255, 0.25);
    }

    b {
      display: block;
      font-size: 17px;
      font-weight: normal;
    }

    span {
      font-size: 12px;
      color: var(--sub);
    }
  }

  /* 流动的虚线箭头 */
  .arrow {
    flex: 1;
    height: 2px;
    margin: 0 -6px 34px;
    background: repeating-linear-gradient(
      90deg,
      var(--cyan) 0 8px,
      transparent 8px 14px
    );
    opacity: 0.75;
    animation: flow 0.8s linear infinite;

    &.off {
      opacity: 0.2;
      animation: none;
    }
  }

  @keyframes flow {
    to {
      background-position: 14px 0;
    }
  }
</style>
