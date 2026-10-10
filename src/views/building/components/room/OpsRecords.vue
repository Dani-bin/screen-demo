<!-- 运维记录：日期、内容、状态（完成 / 待办） -->
<template>
  <section>
    <PanelTitle title="运维记录" />
    <div class="body">
      <ul class="list">
        <li v-for="r in records" :key="r.date + r.text">
          <span class="dt num">{{ r.date }}</span>
          <span class="tx">{{ r.text }}</span>
          <span class="st" :class="{ todo: r.state !== '完成' }">{{
            r.state
          }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  defineProps({
    records: { type: Array, required: true }
  })
</script>

<style lang="scss" scoped>
  .list {
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 7px 0;
      border-bottom: 1px dashed rgba(74, 144, 226, 0.2);
      font-size: 13px;
    }

    .dt {
      color: #8fb4dc;
    }

    .tx {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #e2ecf8;
    }

    .st {
      padding: 1px 8px;
      font-size: 12px;
      background: rgba(61, 220, 151, 0.15);
      color: #3ddc97;

      &.todo {
        background: rgba(47, 155, 255, 0.2);
        color: #59b8ff;
      }
    }
  }
</style>
