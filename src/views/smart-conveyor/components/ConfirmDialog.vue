<!-- 集控操作二次确认：标题、会影响的皮带、确认 / 取消（Esc 取消、Enter 确认） -->
<template>
  <div v-if="ask" class="cf-mask" @click.self="emit('cancel')">
    <div class="cf" :class="ask.danger ? 'danger' : ''" role="dialog">
      <header>
        <b>{{ ask.title }}</b
        ><em>二次确认</em>
      </header>
      <p>{{ ask.text }}</p>
      <ul v-if="ask.affects?.length">
        <li v-for="(x, i) in ask.affects" :key="x">
          <span class="code">{{ String(i + 1).padStart(2, "0") }}</span
          >{{ x }}
        </li>
      </ul>
      <footer>
        <a class="no" @click="emit('cancel')">取消</a>
        <a class="yes" @click="emit('confirm')">{{ ask.yes || "确认执行" }}</a>
      </footer>
    </div>
  </div>
</template>

<script setup>
  const props = defineProps({ ask: { type: Object, default: null } })
  const emit = defineEmits(["confirm", "cancel"])

  function onKey(e) {
    if (!props.ask) return
    if (e.key === "Escape") emit("cancel")
    if (e.key === "Enter") emit("confirm")
  }
  onMounted(() => window.addEventListener("keydown", onKey))
  onBeforeUnmount(() => window.removeEventListener("keydown", onKey))
</script>
