<!--
  电梯运行：客梯 P01～P24、货梯 F01～F04 状态矩阵。
  演示数据：运行 / 待机每隔几秒随机切换几部、运行中的电梯楼层跟着变；检修与故障保持不变
-->
<template>
  <section>
    <PanelTitle title="电梯运行">
      <template #extra
        >{{ runCount }} 部运行 · 共 {{ list.length }} 部</template
      >
    </PanelTitle>
    <div class="body">
      <div class="grid">
        <div v-for="e in list" :key="e.id" class="el" :class="e.state">
          <b class="num">{{ e.id }}</b>
          <span>{{
            e.state === "run" ? `${e.floor}F` : STATE_TEXT[e.state]
          }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  const props = defineProps({
    /** data/building.js 的 towerElevators(key) */
    initial: { type: Array, required: true },
    levels: { type: Number, default: 58 }
  })

  const STATE_TEXT = {
    run: "运行",
    idle: "待机",
    repair: "检修",
    fault: "故障"
  }
  const list = ref(props.initial.map((e) => ({ ...e })))
  const runCount = computed(
    () => list.value.filter((e) => e.state === "run").length
  )

  // 每 2.5 秒：运行中的电梯楼层走几层，随机挑两部在运行 / 待机之间切换
  const timer = setInterval(() => {
    for (const e of list.value) {
      if (e.state !== "run") continue
      e.floor = Math.max(
        1,
        Math.min(props.levels, e.floor + Math.round((Math.random() - 0.5) * 12))
      )
    }
    for (let i = 0; i < 2; i++) {
      const e = list.value[Math.floor(Math.random() * list.value.length)]
      if (e.state === "run" || e.state === "idle")
        e.state = e.state === "run" ? "idle" : "run"
    }
  }, 2500)
  onUnmounted(() => clearInterval(timer))
</script>

<style lang="scss" scoped>
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
  }

  .el {
    padding: 5px 0 4px;
    border: 1px solid rgba(74, 170, 255, 0.4);
    background: rgba(10, 40, 80, 0.45);
    text-align: center;

    b {
      display: block;
      font-size: 15px;
      font-weight: normal;
      color: #fff;
    }

    span {
      font-size: 11px;
      color: #3ddc97;
    }

    &.idle span {
      color: #8aa0bd;
    }

    &.repair {
      border-color: rgba(255, 159, 67, 0.7);

      span {
        color: #ff9f43;
      }
    }

    &.fault {
      border-color: #ff4d5a;
      background: rgba(255, 77, 90, 0.18);

      span {
        color: #ff4d5a;
      }
    }
  }
</style>
