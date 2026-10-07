<!-- 充电桩详情浮窗：点击三维里的桩 / 车位弹出，每秒刷新各枪实时数据 -->
<template>
  <div class="card" :style="pos">
    <div class="hd">
      <b>{{ pile.id }}</b>
      <span
        >{{ pile.type === "super" ? "液冷超充终端" : "直流快充桩" }} ·
        {{ pile.maxKw }} kW</span
      >
      <X class="close" @click="$emit('close')" />
    </div>
    <div v-for="g in guns" :key="g.id" class="gun">
      <div class="gh">
        <span class="side">{{ sideName(g.id) }}</span>
        <i
          class="st"
          :style="{
            color: STATE[g.status].color,
            borderColor: STATE[g.status].color
          }"
          >{{ STATE[g.status].text }}</i
        >
        <span v-if="g.car" class="plate">{{ g.car.plate }}</span>
      </div>
      <template v-if="g.status === 'charging' || g.status === 'full'">
        <div class="soc"><i :style="{ width: `${g.soc * 100}%` }"></i></div>
        <div class="kv">
          <span
            >SOC <b class="num">{{ Math.round(g.soc * 100) }}%</b></span
          >
          <span
            >功率 <b class="num">{{ Math.round(g.power) }} kW</b></span
          >
          <span
            >本单电量 <b class="num">{{ g.energy.toFixed(1) }} kWh</b></span
          >
          <span
            >已充 <b class="num">{{ minutes(g) }} min</b></span
          >
        </div>
      </template>
      <p v-else class="note">{{ STATE[g.status].note }}</p>
    </div>
  </div>
</template>

<script setup>
  import { X } from "lucide-vue-next"
  import { PILES } from "../data/station"
  import { rem } from "../utils"

  const props = defineProps({
    /** { pile, x, y }：x、y 为桩顶在设计稿坐标中的位置 */
    pick: { type: Object, required: true },
    sim: { type: Object, required: true },
    /** 每秒自增，用来触发重新取数 */
    tick: { type: Number, required: true }
  })
  defineEmits(["close"])

  const STATE = {
    idle: { text: "空闲", color: "#2f9bff", note: "枪已归位，等待车辆接入" },
    arriving: {
      text: "车辆驶入",
      color: "#2de2e6",
      note: "车辆进位中，即将插枪"
    },
    charging: { text: "充电中", color: "#34e07a" },
    full: { text: "已充满", color: "#34e07a" },
    leaving: {
      text: "车辆驶离",
      color: "#2f9bff",
      note: "订单已结算，车辆离场中"
    },
    fault: {
      text: "故障",
      color: "#ff3b47",
      note: "绝缘检测异常，已停用并派单检修"
    },
    offline: { text: "离线", color: "#8aa0bd", note: "通讯中断，等待重连" }
  }

  const pile = computed(() => PILES.find((p) => p.id === props.pick.pile))
  // tick 变化时重新取一份枪数据的浅拷贝，让模板刷新
  const guns = computed(() => {
    void props.tick
    return pile.value.guns.map((id) => ({ ...props.sim.gun(id) }))
  })
  const sideName = (id) =>
    id.endsWith("_N") ? "北枪" : id.endsWith("_S") ? "南枪" : "单枪"
  const minutes = (g) =>
    Math.max(1, Math.round((Date.now() - g.startedAt) / 60000))

  /** 浮窗放在桩的右上方；靠近右侧面板时翻到左边 */
  const pos = computed(() => {
    const w = 300
    let x = props.pick.x + 30
    if (x + w > 1440) x = props.pick.x - w - 30
    const y = Math.max(80, props.pick.y - 140)
    return { left: rem(x), top: rem(y) }
  })
</script>

<style lang="scss" scoped>
  .card {
    position: absolute;
    z-index: 6;
    width: 300px;
    padding: 10px 14px 12px;
    border: 1px solid rgba(47, 155, 255, 0.7);
    border-radius: 6px;
    background: rgba(8, 24, 50, 0.94);
    box-shadow: 0 0 20px rgba(47, 155, 255, 0.3);
    font-size: 12px;
  }

  .hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;

    b {
      font-family: "Alimama ShuHeiTi", sans-serif;
      font-size: 20px;
      color: #fff;
    }

    span {
      color: var(--muted);
    }

    .close {
      width: 16px;
      height: 16px;
      margin-left: auto;
      color: var(--muted);
      cursor: pointer;
    }
  }

  .gun {
    padding: 8px 0 4px;
    border-top: 1px solid rgba(74, 144, 226, 0.15);
  }

  .gh {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .side {
    color: #c6d6ea;
  }

  .st {
    padding: 0 5px;
    border: 1px solid;
    border-radius: 2px;
    font-style: normal;
    font-size: 11px;
  }

  .plate {
    margin-left: auto;
    color: #fff;
  }

  .soc {
    position: relative;
    height: 6px;
    margin: 8px 0 6px;
    background: rgba(255, 255, 255, 0.08);

    i {
      position: absolute;
      inset: 0 auto 0 0;
      background: linear-gradient(90deg, #0f8f3f, #34e07a, #a6ffc9);
      box-shadow: 0 0 8px #34e07a;
      transition: width 1s linear;
    }
  }

  .kv {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px 12px;
    color: var(--muted);

    b {
      float: right;
      font-size: 13px;
      font-weight: normal;
      color: #fff;
    }
  }

  .note {
    margin: 6px 0 0;
    color: var(--muted);
  }
</style>
