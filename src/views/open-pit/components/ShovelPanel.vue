<!--
  04 电铲与卸载：7 台电铲的状态 / 队列 / 今日装车，下面四个卸载点（两座破碎站、两个排土场）的今日卸载量（设计稿 #c-shovel 的移植）
  点电铲行 / 卸载点方块 = 选中它（详情卡 + 三维里高亮）
-->
<template>
  <section class="card c-shovel" :class="{ hl: isHl('shovel') }">
    <h3>
      <i>04</i>电铲与卸载<em
        >电铲 {{ fast.shovels.length }} 台 · 破碎站 {{ crushers }} · 排土场
        {{ dumps }}</em
      >
    </h3>
    <div class="tbl">
      <div
        class="th"
        style="
          display: grid;
          grid-template-columns: 50px 40px 78px 1fr 44px;
          gap: 6px;
        "
      >
        <span>电铲</span><span>编组</span><span>状态</span
        ><span style="text-align: right">队列</span
        ><span style="text-align: right">今日趟</span>
      </div>
      <div
        v-for="s in fast.shovels"
        :key="s.id"
        class="r pick"
        :class="{ sel: selection === s.id }"
        style="
          height: 22px;
          display: grid;
          grid-template-columns: 50px 40px 78px 1fr 44px;
          gap: 6px;
        "
        @click="select(s.id)"
      >
        <span class="num" style="font-size: 14.5px">{{ s.id }}</span
        ><span class="mute">{{ s.fleet.replace("FL-", "") }}队</span>
        <span class="chip"
          ><b :style="{ background: SHOVEL_COLOR[s.state] }"></b
          >{{ s.state }}</span
        >
        <span class="mute" style="text-align: right"
          >排队
          <span class="num" style="color: var(--ink)">{{ s.queue }}</span></span
        ><span class="num dim" style="text-align: right">{{ s.loads }}</span>
      </div>
    </div>
    <div
      style="
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-top: 7px;
      "
    >
      <div
        v-for="s in fast.sinks"
        :key="s.id"
        class="pick"
        :class="{ sel: selection === s.id }"
        style="
          border: 1px solid var(--line);
          padding: 0 8px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        "
        @click="select(s.id)"
      >
        <span style="font-size: 13px"
          ><span class="num mute" style="font-size: 12.5px">{{ s.id }}</span>
          {{ SINK_NAME[s.id]
          }}<span v-if="s.queue" class="badge" style="color: var(--c-queue)"
            >排队 {{ s.queue }}</span
          ></span
        ><span class="num" style="font-size: 17px"
          >{{ f2(s.tonsWt)
          }}<span
            class="dim"
            style="font-size: 12px; font-family: var(--f-body)"
          >
            万吨</span
          ></span
        >
      </div>
    </div>
  </section>
</template>

<script setup>
  import { SHOVEL_COLOR, SINK_NAME, f2 } from "../store/derive.js"

  const { fast, selection, select, isHl } = inject("board")
  // 破碎站（CR 开头）、排土场（DP 开头）的个数，来自卸载点明细
  const crushers = computed(
    () => fast.value.sinks.filter((s) => s.id.startsWith("CR")).length
  )
  const dumps = computed(
    () => fast.value.sinks.filter((s) => s.id.startsWith("DP")).length
  )
</script>
