<!-- 综采工作面：推进度、采高，182 架液压支架排成一列，采煤机位置高亮（已割过的一侧标绿） -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>综采工作面 {{ f.id }}<small>B 煤 · 后退式回采</small></h3>
    <div class="kpis wide-first">
      <div class="kpi">
        <span>已推进（共 {{ fmt(f.panelLen) }} m）</span
        ><b class="num">{{ fmt(f.advanced) }}</b
        ><i>m</i>
      </div>
      <div class="kpi">
        <span>今日推进</span><b class="num">{{ f.todayAdvance.toFixed(1) }}</b
        ><i>m</i>
      </div>
      <div class="kpi">
        <span>采高</span><b class="num">{{ f.height.toFixed(1) }}</b
        ><i>m</i>
      </div>
    </div>
    <div class="line">
      <span>液压支架 {{ f.shields }} 架 · 面长 {{ faceLen }} m</span>
      <span v-if="f.cutting" class="warn"
        >采煤机 #{{ f.shearerAt }} {{ f.shearerDir > 0 ? "▶" : "◀" }}
        {{ f.speed.toFixed(1) }} m/min</span
      >
      <span v-else class="dim">采煤机停机（夜班检修）</span>
    </div>
    <div class="shields">
      <i
        v-for="k in SEG"
        :key="k"
        :class="{
          sh: k - 1 === at,
          cut: f.cutting && (f.shearerDir > 0 ? k - 1 < at : k - 1 > at)
        }"
      ></i>
    </div>
    <div class="axis num">
      <span>1 机头</span><span>60</span><span>120</span
      ><span>{{ f.shields }} 机尾</span>
    </div>
  </section>
</template>

<script setup>
  import { fmt } from "../utils"

  const props = defineProps({
    f: { type: Object, required: true },
    faceLen: { type: Number, default: 320 },
    grow: { type: Boolean, default: false }
  })
  /** 每格代表 3 架 */
  const SEG = 61
  const at = computed(() =>
    Math.round(((props.f.shearerAt - 1) / (props.f.shields - 1)) * (SEG - 1))
  )
</script>

<style lang="scss" scoped>
  /* 两个类名：压过页面级 .mine-page .kpis 的三等分 */
  .kpis.wide-first {
    grid-template-columns: 1.6fr 1fr 1fr;
  }

  .line {
    display: flex;
    justify-content: space-between;
    margin-top: 10px;
    font-size: 13px;
    color: var(--sub);

    .warn {
      color: #ffcf3a;
    }

    .dim {
      color: var(--dim);
    }
  }

  .shields {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 26px;
    margin: 6px 0 4px;

    i {
      flex: 1;
      height: 70%;
      background: rgba(76, 157, 255, 0.55);
      transition: background 0.4s;

      &.cut {
        height: 100%;
        background: rgba(61, 220, 151, 0.75);
      }

      &.sh {
        height: 100%;
        background: #ff9a3d;
        box-shadow: 0 0 10px #ff9a3d;
      }
    }
  }

  .axis {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--dim);
  }
</style>
