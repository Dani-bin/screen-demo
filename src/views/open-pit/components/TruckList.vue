<!--
  02 单车列表：故障 / 低电量 / 排队靠后的车优先，点选一行 = 选中该车（详情卡 + 三维里飞到该车）（设计稿 #c-trucks 的移植）
  名单每 10 秒重排一次（slow.notableIds），行里的状态和电量取每秒的实时值；点了编组行则只看该编组
-->
<template>
  <section class="card c-trucks" :class="{ hl: isHl('trucks') }">
    <h3>
      <i>02</i>单车列表<em>{{ hint }}</em>
    </h3>
    <div class="tbl">
      <div
        class="th"
        style="
          display: grid;
          grid-template-columns: 62px 40px 84px 1fr 34px;
          gap: 8px;
        "
      >
        <span>车辆</span><span>编组</span><span>状态</span><span>电量</span
        ><span style="text-align: right">趟</span>
      </div>
      <div
        v-for="x in rows"
        :key="x.id"
        class="r pick"
        :class="{ sel: selection === x.id }"
        style="
          height: 30px;
          display: grid;
          grid-template-columns: 62px 40px 84px 1fr 34px;
          gap: 8px;
        "
        @click="select(x.id)"
      >
        <span class="num" style="font-size: 15px">{{ x.id }}</span
        ><span class="mute">{{ x.fleet.replace("FL-", "") }}队</span>
        <span
          class="chip"
          :style="{ color: x.grp === '故障' ? 'var(--fault)' : 'var(--ink)' }"
          ><b :style="{ background: STATE_COLOR[x.grp] }"></b
          >{{ x.state }}</span
        >
        <span style="display: flex; align-items: center; gap: 8px"
          ><span class="bar"
            ><i
              :style="{
                width: x.soc + '%',
                background: x.low ? 'var(--warn)' : 'var(--c-run)'
              }"
            ></i></span
          ><span
            class="num"
            :style="{
              width: '38px',
              textAlign: 'right',
              fontSize: '14px',
              color: x.low ? 'var(--warn)' : 'var(--ink)'
            }"
            >{{ Math.round(x.soc) }}%</span
          ></span
        >
        <span class="num dim" style="text-align: right">{{
          x.loadsToday
        }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
  import { GROUP_BY_STATE, STATE_COLOR, truckRow } from "../store/derive.js"

  const { fast, truckIds, selection, select, fleetFilter, isHl, layout } =
    inject("board")

  // 行数据：名单取自 truckIds，值取每秒的实时状态
  const rows = computed(() =>
    truckIds.value
      .map((id) => fast.value.byId.get(id))
      .filter(Boolean)
      .map((t) => {
        const r = truckRow(t)
        return { ...r, grp: GROUP_BY_STATE[r.state] || "运行", low: r.soc < 32 }
      })
  )
  const hint = computed(() => {
    if (!fleetFilter.value) return "异常 / 低电量优先 · 点选飞到该车"
    const f = layout.fleets.find((x) => x.id === fleetFilter.value)
    return `${f.id} ${f.name} · 点编组行取消`
  })
</script>
