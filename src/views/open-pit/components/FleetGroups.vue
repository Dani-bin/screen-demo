<!--
  01 车队编组：六类状态总条 + 五个编组各自的状态条、均电量、今日趟数（设计稿 #c-fleet 的移植）
  点编组行 = 单车列表只看这个编组、相机飞到车队视角（再点一次取消）
-->
<template>
  <section class="card c-fleet" :class="{ hl: isHl('fleet') }">
    <h3>
      <i>01</i>车队编组<em
        >{{ cn(fast.fleets.length) }}队 · {{ total }} 台无人矿卡</em
      >
    </h3>
    <div class="seg" style="height: 22px">
      <i
        v-for="(g, i) in fast.groups"
        :key="g.key"
        :style="{ width: (g.n / total) * 100 + '%', background: ST[i].c }"
      ></i>
    </div>
    <div class="legend" style="margin-bottom: 6px">
      <span v-for="(g, i) in fast.groups" :key="g.key"
        ><b :style="{ background: ST[i].c }"></b>{{ g.name
        }}<span class="num">{{ g.n }}</span></span
      >
    </div>
    <div class="tbl" style="margin-top: 2px">
      <div
        v-for="f in fast.fleets"
        :key="f.id"
        class="r pick"
        :class="{ sel: fleetFilter === f.id }"
        style="
          height: 46px;
          display: grid;
          grid-template-columns: 1fr 58px 62px;
          gap: 10px;
          align-items: center;
        "
        @click="pickFleet(f.id)"
      >
        <div>
          <div style="display: flex; justify-content: space-between">
            <span
              ><span class="num mute" style="font-size: 13px">{{ f.id }}</span>
              {{ f.name }}</span
            ><span class="num dim">{{ f.n }}台</span>
          </div>
          <div class="seg" style="height: 7px; margin-top: 5px">
            <i
              v-for="s in ST"
              :key="s.k"
              :style="{
                width: (f.counts[s.k] / f.n) * 100 + '%',
                background: s.c
              }"
            ></i>
          </div>
        </div>
        <div style="text-align: right">
          <div class="num" style="font-size: 17px">
            {{ Math.round(f.avgSoc) }}%
          </div>
          <div class="mute" style="font-size: 11.5px">均电量</div>
        </div>
        <div style="text-align: right">
          <div class="num" style="font-size: 17px">{{ f.loadsToday }}</div>
          <div class="mute" style="font-size: 11.5px">今日趟数</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import { ST } from "../store/derive.js"

  const { fast, fleetFilter, pickFleet, isHl } = inject("board")
  const total = computed(() => fast.value.groups.reduce((a, g) => a + g.n, 0))
  // 编组数写成汉字（五队）
  const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
  const cn = (n) => CN[n] ?? String(n)
</script>
