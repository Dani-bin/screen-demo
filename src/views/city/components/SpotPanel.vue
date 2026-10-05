<!-- 景点介绍：实景图位、名称、简介、四项键值 -->
<template>
  <section class="panel spot-panel">
    <h2 class="panel-title">
      景点介绍
      <span class="title-en"
        >Spot {{ String(index + 1).padStart(2, "0") }} /
        {{ String(total).padStart(2, "0") }}</span
      >
    </h2>
    <!-- 有实景图时铺满图位；没有、或加载失败（路径写错、文件缺失）时显示渐变占位块 -->
    <div class="spot-pic">
      <img
        v-if="spot.image && !broken"
        :src="imageUrl"
        :alt="spot.name"
        :style="{ objectPosition: spot.imagePosition || 'center' }"
        @error="broken = true"
      />
      <span v-else>实景图位</span>
    </div>
    <div class="spot-name">{{ spot.name }}</div>
    <div class="spot-en">{{ spot.en }}</div>
    <p class="spot-desc">{{ spot.desc }}</p>
    <!-- facts 为 [键, 值] 二元组数组，两列排布 -->
    <div class="spot-facts">
      <div v-for="[k, v] in spot.facts" :key="k">
        <span>{{ k }}</span>
        <b>{{ v }}</b>
      </div>
    </div>
  </section>
</template>

<script setup>
  const props = defineProps({
    spot: { type: Object, required: true },
    index: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  })

  /**
   * 实景图地址：cityData 里写相对 public/ 的路径，这里拼上 BASE_URL
   * （开发环境为 /，生产环境部署在 /bi/ 下，直接写死 / 开头会 404）；
   * 以 / 或 http(s) 开头的地址视为已是完整地址，原样使用
   */
  const imageUrl = computed(() => {
    const src = props.spot.image
    if (!src || /^(\/|https?:)/.test(src)) return src
    return `${import.meta.env.BASE_URL}${src}`
  })

  // 当前图片是否加载失败；换站（地址变了）时清掉，让新图重新尝试加载
  const broken = ref(false)
  watch(imageUrl, () => {
    broken.value = false
  })
</script>

<style lang="scss" scoped>
  .spot-pic {
    height: 140px;
    margin-bottom: 12px;
    border-radius: 8px;
    overflow: hidden;
    background: linear-gradient(160deg, #cfe6e8, #8fc7cc 60%, #5aa9b0);
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    font-size: 10px;
    letter-spacing: 2px;
    color: #fff;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    /* 内边距只给占位文字，实景图贴边铺满 */
    span {
      padding: 8px;
    }
  }

  .spot-name {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 2px;
    color: var(--city-ink);
  }

  .spot-en {
    margin: 2px 0 10px;
    font-size: 10px;
    letter-spacing: 3px;
    color: var(--city-teal);
  }

  .spot-desc {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.85;
    text-align: justify;
    color: #34434f;
  }

  .spot-facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    font-size: 12px;

    div {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid var(--city-line);
    }

    span {
      color: var(--city-ink-soft);
    }

    b {
      font-weight: 600;
      color: var(--city-ink);
    }
  }
</style>
