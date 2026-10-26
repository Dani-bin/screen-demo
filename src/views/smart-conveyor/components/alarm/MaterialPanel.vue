<!-- A3 料：今日异物 / 大块 / 堵料 / 物料超温次数，每类最近一次的 AI 抓拍（示意画面） -->
<template>
  <Panel no="A3" title="料 · 物料异常" en="MATERIAL · AI VISION">
    <div class="mt">
      <div v-for="x in kinds" :key="x.kind" class="mt-i" :class="{ hot: x.n }">
        <div class="mt-shot">
          <CamView
            v-if="x.last"
            :cam="{ id: x.last.device, state: 'online', conf: 96 }"
            :v="0.4"
            :load="0.7"
            :hit="x.name"
            :now="x.last.at"
            :seed="x.seed"
          />
          <span v-else class="mt-none">今日无</span>
        </div>
        <div class="mt-t">
          <b>{{ x.n }}</b
          ><span>{{ x.name }}</span>
          <em v-if="x.last"
            >{{ hm(x.last.at) }} · {{ beltShort(x.last.belt) }}</em
          >
        </div>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import CamView from "../run/CamView.vue"
  import { beltShort as short, hm } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({ w: { type: Object, required: true } })
  const beltShort = (id) => short(layout, id)

  const KINDS = [
    ["foreign", "异物", 11],
    ["bigLump", "大块", 12],
    ["blockage", "堵料", 13],
    ["hotMat", "物料超温", 14]
  ]
  const kinds = computed(() =>
    KINDS.map(([kind, name, seed]) => {
      const ev = props.w.today.filter((e) => e.kind === kind)
      return {
        kind,
        name,
        seed,
        n: ev.length,
        last: ev.sort((a, b) => b.at - a.at)[0] || null
      }
    })
  )
</script>
