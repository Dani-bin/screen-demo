<!--
  当前地标介绍面板
  chip 标明信息可靠度：fact = 有实拍或百科依据，infer = 依据形制推断、
  尚未获校方确认。推断项用橙色标注，避免把推测当成事实展示在大屏上。
-->
<template>
  <section class="panel landmark-panel">
    <h2 class="panel-title">
      当前地标
      <span class="title-en">Landmark</span>
    </h2>

    <div class="landmark-head">
      <div class="landmark-no">{{ String(index + 1).padStart(2, "0") }}</div>
      <div>
        <div class="landmark-name">
          {{ landmark.name }}
          <span class="landmark-chip" :class="`chip-${landmark.chip.type}`">
            {{ landmark.chip.text }}
          </span>
        </div>
        <div class="landmark-en">{{ landmark.en }}</div>
      </div>
    </div>

    <!-- 实拍照片位：拿到学校授权照片后放入 src/assets/images/school/ 即可 -->
    <div class="photo-slot">实拍照片位 · 待接入</div>

    <p class="landmark-desc">{{ landmark.desc }}</p>

    <dl class="landmark-facts">
      <div v-for="fact in landmark.facts" :key="fact[0]" class="fact-row">
        <dt>{{ fact[0] }}</dt>
        <dd>{{ fact[1] }}</dd>
      </div>
    </dl>

    <div class="landmark-src">{{ landmark.src }}</div>
  </section>
</template>

<script setup>
  defineProps({
    landmark: { type: Object, required: true },
    index: { type: Number, default: 0 }
  })
</script>

<style lang="scss" scoped>
  .landmark-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 12px;
  }

  .landmark-no {
    flex: none;
    font-size: 40px;
    line-height: 0.9;
    color: var(--school-brick);
    opacity: 0.32;
    font-variant-numeric: tabular-nums;
  }

  .landmark-name {
    font-size: 22px;
    font-weight: 600;
    color: var(--school-ink);
  }

  .landmark-en {
    margin-top: 3px;
    font-size: 11px;
    letter-spacing: 1.6px;
    color: var(--school-ink-faint);
  }

  .landmark-chip {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 7px;
    border-radius: 2px;
    font-size: 11px;
    letter-spacing: 0.5px;
    vertical-align: 3px;
  }

  .chip-fact {
    color: var(--school-turf);
    border: 1px solid rgba(94, 143, 78, 0.42);
    background: rgba(94, 143, 78, 0.1);
  }

  .chip-infer {
    color: var(--school-chip-infer);
    border: 1px solid rgba(184, 121, 31, 0.4);
    background: rgba(184, 121, 31, 0.09);
  }

  .photo-slot {
    width: 100%;
    aspect-ratio: 16 / 9;
    margin-bottom: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed rgba(166, 80, 60, 0.38);
    background: repeating-linear-gradient(
      45deg,
      rgba(166, 80, 60, 0.045) 0 10px,
      transparent 10px 20px
    );
    font-size: 13px;
    letter-spacing: 1px;
    color: rgba(166, 80, 60, 0.7);
  }

  .landmark-desc {
    margin: 0 0 12px;
    font-size: 13.5px;
    line-height: 1.9;
    color: var(--school-ink-soft);
  }

  .landmark-facts {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 0;
  }

  .fact-row {
    display: flex;
    gap: 10px;
    font-size: 13px;

    dt {
      flex: none;
      width: 62px;
      color: var(--school-ink-faint);
    }

    dd {
      margin: 0;
      color: var(--school-ink);
    }
  }

  .landmark-src {
    margin-top: 13px;
    padding-top: 11px;
    border-top: 1px solid var(--school-rule);
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--school-ink-faint);
  }
</style>
