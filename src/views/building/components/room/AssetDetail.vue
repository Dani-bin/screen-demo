<!-- 资产详情：名称 + 编号 + 状态，八项属性（两列），下方三格实时读数 -->
<template>
  <section>
    <PanelTitle title="资产详情" />
    <div class="body">
      <div class="card">
        <div class="hd">
          <b
            >{{ asset.name }} · <span class="num">{{ asset.id }}</span></b
          >
          <span class="st" :class="asset.level">{{ statusText }}</span>
        </div>
        <div class="kv">
          <div v-for="f in asset.fields" :key="f.k">
            <span>{{ f.k }}</span>
            <p>{{ f.v }}</p>
          </div>
        </div>
      </div>
      <div class="cells">
        <div v-for="m in asset.metrics" :key="m.name" class="cell">
          <b class="num">{{ m.value }}</b
          ><small>{{ m.unit }}</small
          ><span>{{ m.name }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  const props = defineProps({
    asset: { type: Object, required: true }
  })

  const statusText = computed(() =>
    props.asset.status === "运行" ? "运行中" : props.asset.status
  )
</script>

<style lang="scss" scoped>
  .card {
    padding: 12px 14px;
    border: 1px solid rgba(255, 198, 90, 0.5);
    background: linear-gradient(
      180deg,
      rgba(60, 40, 6, 0.55),
      rgba(20, 16, 8, 0.4)
    );
  }

  .hd {
    display: flex;
    align-items: center;
    justify-content: space-between;

    b {
      font-size: 17px;
      font-weight: normal;
      color: #ffe6b0;
    }

    .st {
      padding: 1px 8px;
      font-size: 12px;
      background: rgba(61, 220, 151, 0.18);
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

  .kv {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 14px;
    margin-top: 10px;

    span {
      font-size: 11px;
      color: #8a97a8;
    }

    p {
      margin: 2px 0 0;
      font-size: 13px;
      color: #e8edf4;
    }
  }

  .cells {
    margin-top: 12px;
  }
</style>
