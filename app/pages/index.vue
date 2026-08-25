<script setup lang="ts">
useHead({ title: 'Home' })
</script>

<template>
  <div class="sys-container pt-5 md:pt-7 pb-9">
    <div class="grid grid-cols-12 gap-y-8 lg:gap-6">
      <HomeContinueListening class="sys-col-12 lg:sys-col-7" />
      <HomeAIRecommendation class="sys-col-12 lg:sys-col-5" />
    </div>

    <HomeRecentlyPlayed class="mt-8" />
    <HomeMusicStats class="mt-8" />
  </div>
</template>
