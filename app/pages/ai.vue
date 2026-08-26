<script setup lang="ts">
// ============================================================
// AI — SYSTEMA MUSIC COMPANION
// ============================================================
// An intelligent music companion, not an AI dashboard.
//
// Composition:
//   Header · EMO · Status · Prompt · Quick actions ·
//   Conversation · FOR YOU · Current track AI · History sheet
//
// State ownership:
//   useAIStore()     — conversation, status, history (mock)
//   usePlayerStore() — currentTrack, isPlaying, queue (shared)
// The AI page never duplicates playback state.
//
// FUTURE: the mock responder inside useAIStore is the only
// seam that changes when the native runtime lands:
//   Nuxt UI → Pinia → Capacitor → Kotlin → Local AI Runtime
//           → Music Analysis JSON Database
// ============================================================

import type { Track } from '~/types'
import type { AIQuickAction } from '~/types/ai'
import { aiForYouSections, aiPromptExamples, aiQuickActions } from '~/data/aiCompanion'
import { useAIStore } from '~/stores/ai'
import { usePlayerStore } from '~/stores/player'

useHead({ title: 'AI' })
definePageMeta({
  layout: 'default',
  hideMobileHeader: true,
  pageTransition: { name: 'sys-ai', mode: 'out-in' },
})

const ai = useAIStore()
const player = usePlayerStore()
const { playRecommendation, queueRecommendation } = useAICompanion()

const prompt = ref<{ focus: () => void } | null>(null)
const menuTrack = ref<Track | null>(null)

// Conversations are read from storage on the client only.
onMounted(() => ai.hydrate())
onBeforeUnmount(() => ai.dispose())

const hasTrack = computed(() => Boolean(player.currentTrack))
const showExamples = computed(() => !ai.hasConversation && !ai.isBusy)

function onSubmit() {
  ai.send()
}

function onExample(text: string) {
  ai.setDraft(text)
  prompt.value?.focus()
}

function onQuickAction(action: AIQuickAction) {
  ai.runQuickAction(action.id, action.prompt)
}

function onPlay(track: Track) {
  playRecommendation(track)
}

function onMenu(track: Track) {
  menuTrack.value = track
}

function onMenuAction(id: string, track: Track) {
  switch (id) {
    case 'play':
      playRecommendation(track)
      break
    case 'play-next':
      player.addToQueue(track, true)
      break
    case 'queue':
      queueRecommendation(track)
      break
    case 'favorite':
      player.toggleFavoriteId(track.id)
      break
    case 'ask':
      ai.send(`Tell me about "${track.title}"`)
      break
    case 'similar':
      ai.send(`Find tracks similar to "${track.title}"`)
      break
  }
}

// EMO tap is a friendly nudge back into the input.
function onEmoTap() {
  prompt.value?.focus()
}
</script>

<template>
  <div class="ai-companion-page">
    <!-- atmospheric grid, masked toward the top only -->
    <div class="ai-grid-fade pointer-events-none absolute inset-x-0 top-0 h-[32rem]" aria-hidden="true" />

    <div class="relative">
      <AICompanionHeader
        :can-reset="ai.hasConversation"
        @history="ai.setHistoryOpen(true)"
        @reset="ai.startNewConversation()"
      />

      <div class="mx-auto flex w-full max-w-[42rem] flex-col gap-7 pb-8 md:max-w-[46rem]">
        <!-- EMO + STATUS -->
        <div class="flex flex-col gap-4">
          <AICompanionStage
            :status="ai.status"
            :expression="ai.emoExpression"
            :line="ai.statusLine"
            :compact="ai.hasConversation"
            @tap="onEmoTap"
          />
          <AICompanionStatus
            :status="ai.status"
            :engine="ai.engineLabel"
            :analyzed-tracks="ai.analyzedTracks"
          />
        </div>

        <!-- PROMPT -->
        <AICompanionPrompt
          ref="prompt"
          :model-value="ai.draft"
          :busy="ai.isBusy"
          :examples="showExamples ? aiPromptExamples : []"
          @update:model-value="ai.setDraft"
          @submit="onSubmit"
          @example="onExample"
        />

        <!-- QUICK ACTIONS -->
        <AICompanionActions
          :actions="aiQuickActions"
          :has-track="hasTrack"
          :busy="ai.isBusy"
          @run="onQuickAction"
        />

        <!-- CONVERSATION -->
        <AICompanionConversation
          v-if="ai.hasConversation || ai.status === 'thinking'"
          :messages="ai.messages"
          :thinking="ai.status === 'thinking'"
          :typing-message-id="ai.typingMessageId"
          :typed-length="ai.typedLength"
          @play="onPlay"
          @menu="onMenu"
        />

        <!-- FOR YOU -->
        <AICompanionForYou
          :sections="aiForYouSections"
          @play="onPlay"
          @menu="onMenu"
        />

        <!-- ON-DEVICE DSP — the one real-measurement panel here -->
        <AICompanionAnalysis />

        <!-- CURRENT TRACK AI -->
        <AICompanionTrack
          v-if="player.currentTrack && ai.currentTrackInsight"
          :track="player.currentTrack"
          :artist="ai.currentTrackArtist"
          :cover="ai.currentTrackCover"
          :insight="ai.currentTrackInsight"
          :busy="ai.isBusy"
          @ask="ai.askAboutCurrentTrack()"
          @analyze="ai.analyzeCurrentTrack()"
        />
      </div>
    </div>

    <!-- CHAT HISTORY -->
    <AICompanionHistory
      :open="ai.historyOpen"
      :groups="ai.groupedConversations"
      :query="ai.historyQuery"
      :active-id="ai.activeConversationId"
      :total="ai.conversations.length"
      @close="ai.setHistoryOpen(false)"
      @update:query="ai.setHistoryQuery"
      @select="ai.openConversation"
      @delete="ai.deleteConversation"
      @clear="ai.clearHistory()"
    />

    <!-- RESULT ACTIONS -->
    <AICompanionTrackActions
      :track="menuTrack"
      @close="menuTrack = null"
      @action="onMenuAction"
    />
  </div>
</template>
