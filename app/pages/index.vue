<script setup lang="ts">
useHead({ title: 'Home' })

const { hasItems: hasContinueListening } = useContinueListening()
</script>

<template>
  <div class="sys-container pt-5 md:pt-7 pb-9">
    <div class="grid grid-cols-12 gap-y-8 lg:gap-6">
      <HomeContinueListening
        v-if="hasContinueListening"
        class="col-span-12 lg:col-span-7"
      />
      <HomeAIRecommendation
        class="col-span-12"
        :class="hasContinueListening ? 'lg:col-span-5' : 'lg:col-span-12'"
      />
    </div>

    <HomeRecentlyPlayed class="mt-8" />
    <HomeMusicStats class="mt-8" />
  </div>
</template>
