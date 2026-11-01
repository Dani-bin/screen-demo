<!--
  配套 / 景观说明卡：沿用楼栋信息卡的样式，内容是名称、所属类别、一段说明和几个事实
  事实从布局派生：层数、占地面积；地块外的对象标"小区周边"。
-->
<template>
  <aside class="shell card">
    <div class="core">
      <div class="row1">
        <span class="eyebrow">{{ layerName }}</span>
        <div class="acts">
          <span v-if="a.outside" class="eyebrow">小区周边</span>
          <span class="iconbtn" title="镜头飞到这里" @click="$emit('focus')">
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
      <h2>{{ a.name }}</h2>
      <p class="desc">{{ a.desc }}</p>
      <div class="facts">
        <div v-if="a.floors">
          <span>层数</span><b>{{ a.floors }}<i>层</i></b>
        </div>
        <div v-if="area">
          <span>占地面积</span><b>{{ area }}<i>㎡</i></b>
        </div>
        <div>
          <span>编号</span><b>{{ a.id }}</b>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
  import { fmt } from "../utils.js"

  const props = defineProps({
    a: { type: Object, required: true },
    layerName: { type: String, default: "" }
  })
  defineEmits(["close", "focus"])

  /** 占地面积：湖按椭圆算，其余按外框；太长的（河、公园）不显示 */
  const area = computed(() => {
    const a = props.a
    if (a.w > 200 || a.d > 200) return ""
    const v = a.shape === "lake" ? (Math.PI / 4) * a.w * a.d : a.w * a.d
    return fmt(Math.round(v / 10) * 10)
  })
</script>
