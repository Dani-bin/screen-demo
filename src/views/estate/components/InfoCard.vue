<!--
  选中楼栋的信息卡：层数 / 户数 / 高度 / 户型表 / 销售条（定稿 left 86 top 276）
  销售条：已售、认购、在售三段，细条 + 2px 间隙；在售是未售剩余，用中性轨道；下方有图例和直接标注。
-->
<template>
  <aside class="shell card">
    <div class="core">
      <div class="row1">
        <span class="eyebrow">{{ b.kindName }} · {{ b.floors }} 层</span>
        <div class="acts">
          <span class="state" :class="s.state">{{ STATE_NAME[s.state] }}</span>
          <span class="iconbtn" title="镜头飞到这栋" @click="$emit('focus')">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            >
              <circle cx="8" cy="8" r="2.4" />
              <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
            </svg>
          </span>
          <span class="iconbtn" title="收起" @click="$emit('close')">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </span>
        </div>
      </div>
      <h2>{{ b.name }}</h2>
      <div class="tags">
        <span v-for="t in [...b.tags, b.facing]" :key="t">{{ t }}</span>
      </div>
      <div class="stats">
        <div>
          <b>{{ b.units }}<i>户</i></b
          ><small>总户数</small>
        </div>
        <div>
          <b>{{ b.height.toFixed(1) }}<i>m</i></b
          ><small>建筑高度</small>
        </div>
        <div>
          <b>{{ b.floors }}<i>层</i></b
          ><small>层数</small>
        </div>
      </div>
      <h3>户型</h3>
      <div class="types">
        <div v-for="u in b.unitTypes" :key="u.name">
          <span>{{ u.name }}</span>
          <b>{{ u.area }}<i>㎡</i></b>
        </div>
      </div>
      <h3>销售情况</h3>
      <div class="bar">
        <span class="sold" :style="{ flex: Math.max(s.sold, 0.0001) }"></span>
        <span
          class="rsv"
          :style="{ flex: Math.max(s.reserved, 0.0001) }"
        ></span>
        <span class="opn" :style="{ flex: Math.max(s.open, 0.0001) }"></span>
      </div>
      <div class="legend">
        <div>
          <em style="background: var(--bar-sold)"></em>已售<b
            >{{ s.sold }}<i>户</i></b
          >
        </div>
        <div>
          <em style="background: var(--bar-reserved)"></em>认购<b
            >{{ s.reserved }}<i>户</i></b
          >
        </div>
        <div>
          <em style="background: var(--bar-open)"></em>在售<b
            >{{ s.open }}<i>户</i></b
          >
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
  import { STATE_NAME } from "../utils.js"

  defineProps({
    b: { type: Object, required: true },
    s: { type: Object, required: true }
  })
  defineEmits(["close", "focus"])
</script>
