<script setup lang="ts">
import type { LibrarySection } from '~/composables/useLibrary'

const props = defineProps<{
  active: LibrarySection
  sections: { id: LibrarySection; label: string }[]
}>()

const emit = defineEmits<{
  select: [section: LibrarySection]
}>()

const activeIndex = computed(() => Math.max(0, props.sections.findIndex(section => section.id === props.active)))
const indicatorStyle = computed(() => ({
  width: `${100 / props.sections.length}%`,
  transform: `translateX(${activeIndex.value * 100}%)`,
}))
</script>

<template>
  <nav class="library-tabs" aria-label="Library sections">
    <div class="library-tabs__buttons" role="tablist">
      <button
        v-for="section in sections"
        :key="section.id"
        class="library-tabs__button text-micro focus-ring"
        :class="{ 'is-active': active === section.id }"
        role="tab"
        :aria-selected="active === section.id"
        :aria-controls="`library-${section.id}`"
        @click="emit('select', section.id)"
      >{{ section.label }}</button>
    </div>
    <span class="library-tabs__line" aria-hidden="true"><span :style="indicatorStyle" /></span>
  </nav>
</template>

<style scoped>
.library-tabs {
  border-bottom: var(--library-line-width) solid var(--sys-border);
}

.library-tabs__buttons {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.library-tabs__button {
  display: grid;
  min-width: 0;
  min-height: var(--library-tab-height);
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--sys-foreground-faint);
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.library-tabs__button.is-active { color: var(--sys-foreground); }

.library-tabs__line {
  display: block;
  height: var(--library-indicator-height);
  overflow: hidden;
  background: var(--sys-border);
}

.library-tabs__line > span {
  display: block;
  height: 100%;
  background: var(--sys-primary);
  transition: transform var(--library-motion) var(--sys-ease);
}
</style>
