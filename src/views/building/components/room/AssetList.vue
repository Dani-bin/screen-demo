<!-- 资产清单：名称、编号、状态；按当前分类筛选，点击选中（与三维联动），悬浮高亮三维设备 -->
<template>
  <section>
    <PanelTitle title="资产清单">
      <template #extra>共 {{ items.length }} 件</template>
    </PanelTitle>
    <div class="body">
      <ul class="list">
        <li
          v-for="a in items"
          :key="a.id"
          :class="{ sel: a.id === selected, hov: a.id === hovered }"
          @click="$emit('select', a.id)"
          @mouseenter="$emit('hover', a.id)"
          @mouseleave="$emit('hover', null)"
        >
          <span class="nm">{{ a.name }}</span>
          <span class="id num">{{ a.id }}</span>
          <span class="st" :class="a.level">{{ a.status }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  const props = defineProps({
    assets: { type: Array, required: true },
    cat: { type: String, default: "all" },
    selected: { type: String, default: null },
    hovered: { type: String, default: null }
  })
  defineEmits(["select", "hover"])

  const items = computed(() =>
    props.cat === "all"
      ? props.assets
      : props.assets.filter((a) => a.cat === props.cat)
  )
</script>

<style lang="scss" scoped>
  .list {
    max-height: 252px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 28px;
      padding: 0 8px;
      border-left: 2px solid transparent;
      font-size: 13px;
      cursor: pointer;

      &:nth-child(odd) {
        background: rgba(20, 70, 140, 0.12);
      }

      &.hov {
        background: rgba(47, 155, 255, 0.16);
      }

      &.sel {
        border-left-color: #ffc65a;
        background: linear-gradient(
          90deg,
          rgba(150, 100, 20, 0.45),
          rgba(150, 100, 20, 0.08)
        );

        .nm {
          color: #ffe6b0;
        }
      }
    }

    .nm {
      width: 96px;
      color: #e2ecf8;
    }

    .id {
      flex: 1;
      font-size: 12px;
      color: #8fb4dc;
    }

    .st {
      min-width: 52px;
      padding: 1px 0;
      text-align: center;
      font-size: 12px;
      background: rgba(61, 220, 151, 0.15);
      color: #3ddc97;

      &.warn {
        background: rgba(255, 159, 67, 0.2);
        color: #ff9f43;
      }

      &.busy {
        background: rgba(47, 155, 255, 0.2);
        color: #59b8ff;
      }
    }
  }
</style>
