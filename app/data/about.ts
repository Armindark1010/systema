// Honest product metadata. Do not invent a published version.
export const SYSTEMA_ABOUT = {
  name: 'SYSTEMA',
  packageName: 'systema',
  version: null as string | null,
  channel: 'development',
  description: 'A precise, intelligent music system. Swiss archive, playback engine, and AI studio.',
  stack: [
    { label: 'NUXT', value: '4.5.2' },
    { label: 'VUE', value: '3.5.41' },
    { label: 'PINIA', value: '4.0.3' },
    { label: 'UNOCSS', value: '66.8.1' },
    { label: 'NUXT UI', value: '3.3.7' },
    { label: 'VUEUSE', value: '14.4.0' },
    { label: 'TYPESCRIPT', value: '5.6.3' },
  ],
  credits: [
    { label: 'LATIN TYPE', value: 'Inter' },
    { label: 'PERSIAN TYPE', value: 'Vazirmatn' },
    { label: 'ICONS', value: 'Lucide' },
  ],
} as const
