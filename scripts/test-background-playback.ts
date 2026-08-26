// ============================================================
// SYSTEMA — Phase 3: background playback / MediaSession tests
// ============================================================
// These are STATIC verification tests. Background playback is an
// Android runtime behaviour that cannot be exercised from Node: there
// is no MediaSessionService, no notification shade and no lock screen
// here. What CAN be verified automatically, and is verified below, is
// that the wiring which produces that behaviour is present and
// correct:
//
//   - the manifest declares the service, its foreground type and the
//     exact permissions Android requires
//   - dependencies are pinned to one Media3 version
//   - there is exactly ONE ExoPlayer, ONE MediaSession, ONE service
//   - the session publishes the SAME engine the plugin drives
//   - no polling, wake locks or hand-built notifications
//   - the web build keeps its guards
//
// Anything requiring real hardware is listed in the final report as
// unverified rather than asserted here.
// ============================================================

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const MANIFEST = 'android/app/src/main/AndroidManifest.xml'
const SERVICE = 'android/app/src/main/java/com/systema/music/player/PlaybackService.kt'
const ENGINE = 'android/app/src/main/java/com/systema/music/player/PlayerEngine.kt'
const PLUGIN = 'android/app/src/main/java/com/systema/music/player/PlayerPlugin.kt'
const GRADLE = 'android/app/build.gradle'
const VARIABLES = 'android/variables.gradle'
const NATIVE_COMPOSABLE = 'app/composables/useNativePlayer.ts'
const PLUGIN_TS = 'app/services/native/playerPlugin.ts'
const SERVICE_TS = 'app/services/native/playerService.ts'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function group(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

// ------------------------------------------------------------
group('1. Playback service exists and is a MediaSessionService')
// ------------------------------------------------------------
{
  check('PlaybackService.kt created', existsSync(join(root, SERVICE)))
  const svc = read(SERVICE)
  check('extends MediaSessionService', /class\s+PlaybackService\s*:\s*MediaSessionService\(\)/.test(svc))
  check('imports Media3 session APIs', svc.includes('androidx.media3.session.MediaSession'))
  check('implements onGetSession', svc.includes('override fun onGetSession'))
  check('handles onTaskRemoved', svc.includes('override fun onTaskRemoved'))
  check('releases the session in onDestroy', /onDestroy[\s\S]*mediaSession\?\.run\s*\{[\s\S]*release\(\)/.test(svc))
}

// ------------------------------------------------------------
group('2. Exactly one player, one session, one service')
// ------------------------------------------------------------
{
  const svc = read(SERVICE)
  const engine = read(ENGINE)

  // The service must NOT build its own ExoPlayer.
  check('service does not construct an ExoPlayer', !svc.includes('ExoPlayer.Builder'))
  check('service publishes the shared engine', svc.includes('PlayerEngine.get(applicationContext)'))
  check('service obtains the same player instance', svc.includes('.sessionPlayer()'))
  check('service survives an engine that cannot build a player',
    /sessionPlayer\(\)[\s\S]*?catch \(t: Throwable\)[\s\S]*?stopSelf\(\)/.test(svc))

  // Exactly one ExoPlayer construction in the whole codebase.
  const builders = (engine.match(/ExoPlayer\.Builder/g) ?? []).length
  check('exactly one ExoPlayer.Builder in the engine', builders === 1, `found ${builders}`)

  // Exactly one MediaSession.Builder in the whole codebase.
  const sessions = (svc.match(/MediaSession\.Builder/g) ?? []).length
  check('exactly one MediaSession.Builder', sessions === 1, `found ${sessions}`)

  check('engine exposes sessionPlayer()', engine.includes('fun sessionPlayer(): ExoPlayer'))
  check('sessionPlayer reuses ensurePlayer (no second instance)',
    /fun sessionPlayer\(\): ExoPlayer = ensurePlayer\(\)/.test(engine))
}

// ------------------------------------------------------------
group('3. Manifest: service declaration')
// ------------------------------------------------------------
{
  const m = read(MANIFEST)
  check('service is declared', m.includes('android:name=".player.PlaybackService"'))
  check('service is NOT exported', /PlaybackService[\s\S]{0,200}android:exported="false"/.test(m))
  check('foregroundServiceType is mediaPlayback',
    /android:foregroundServiceType="mediaPlayback"/.test(m))
  check('foreground type is specific, not generic',
    !/foregroundServiceType="(dataSync|specialUse)"/.test(m))
  check('MediaSessionService intent filter present',
    m.includes('androidx.media3.session.MediaSessionService'))
  check('MEDIA_BUTTON intent filter present (headset/Bluetooth)',
    m.includes('android.intent.action.MEDIA_BUTTON'))
}

// ------------------------------------------------------------
group('4. Manifest: permissions')
// ------------------------------------------------------------
{
  const m = read(MANIFEST)
  check('FOREGROUND_SERVICE declared',
    m.includes('android.permission.FOREGROUND_SERVICE"'))
  check('FOREGROUND_SERVICE_MEDIA_PLAYBACK declared (API 34+)',
    m.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'))
  check('POST_NOTIFICATIONS declared (API 33+)',
    m.includes('android.permission.POST_NOTIFICATIONS'))

  // Phase 1's storage strategy must be untouched.
  check('READ_MEDIA_AUDIO still present', m.includes('android.permission.READ_MEDIA_AUDIO'))
  check('READ_EXTERNAL_STORAGE still capped at API 32',
    /READ_EXTERNAL_STORAGE"[\s\S]{0,80}android:maxSdkVersion="32"/.test(m))

  // No broad filesystem permissions introduced for background playback.
  check('no MANAGE_EXTERNAL_STORAGE', !m.includes('MANAGE_EXTERNAL_STORAGE'))
  check('no WRITE_EXTERNAL_STORAGE', !m.includes('WRITE_EXTERNAL_STORAGE'))
  check('no WAKE_LOCK permission', !m.includes('android.permission.WAKE_LOCK'))
}

// ------------------------------------------------------------
group('5. Dependencies: one consistent Media3 version')
// ------------------------------------------------------------
{
  const g = read(GRADLE)
  const v = read(VARIABLES)

  check('media3-session added', g.includes('androidx.media3:media3-session:$media3Version'))
  check('media3-exoplayer still present', g.includes('androidx.media3:media3-exoplayer:$media3Version'))
  check('media3-common still present', g.includes('androidx.media3:media3-common:$media3Version'))

  // Every Media3 dependency must use the shared variable, so no second
  // version line can enter the graph.
  const media3Lines = g.split('\n').filter(l => l.includes('androidx.media3:'))
  check('all Media3 deps use $media3Version',
    media3Lines.length > 0 && media3Lines.every(l => l.includes('$media3Version')),
    media3Lines.join(' | '))
  check('no hardcoded Media3 version numbers',
    !/androidx\.media3:[a-z0-9-]+:\d/.test(g))

  const version = v.match(/media3Version\s*=\s*'([^']+)'/)?.[1]
  check('media3Version is pinned in variables.gradle', Boolean(version), String(version))
  check('media3Version unchanged at 1.10.1 (Kotlin 2.1.x compatible)', version === '1.10.1', String(version))
}

// ------------------------------------------------------------
group('6. Foreground service lifecycle')
// ------------------------------------------------------------
{
  const engine = read(ENGINE)
  const svc = read(SERVICE)

  check('service is started when playback is requested',
    engine.includes('ensureServiceStarted()'))
  check('start is latched, not repeated', engine.includes('if (serviceStarted) return'))
  check('service start failure does not crash playback',
    /ensureServiceStarted\(\)[\s\S]{0,700}catch \(t: Throwable\)/.test(engine))
  check('service is stopped when the engine is released',
    /stopService\(Intent\(appContext, PlaybackService::class\.java\)\)/.test(engine))
  check('swiping the app away while idle stops the service',
    svc.includes('stopSelf()'))
  check('swiping away while playing keeps the session alive',
    /playWhenReady[\s\S]{0,200}stopSelf\(\)/.test(svc))
}

// ------------------------------------------------------------
group('7. No polling, timers, wake locks or manual notifications')
// ------------------------------------------------------------
{
  const svc = read(SERVICE)
  const engine = read(ENGINE)
  const both = svc + engine

  check('no WakeLock usage', !both.includes('WakeLock') && !both.includes('acquire('))
  check('no scheduled executor / timer loops',
    !both.includes('ScheduledExecutor') && !both.includes('Timer('))
  check('no manual NotificationCompat building', !both.includes('NotificationCompat.Builder'))
  check('no manual notification channel creation', !both.includes('NotificationChannel('))
  check('no startForeground call (Media3 owns it)', !svc.includes('startForeground('))
  check('service holds no Activity reference', !svc.includes('MainActivity'))
  check('service uses application context for the engine',
    svc.includes('applicationContext'))
}

// ------------------------------------------------------------
group('8. Audio focus and media buttons via Media3')
// ------------------------------------------------------------
{
  const engine = read(ENGINE)
  check('audio focus delegated to Media3', /handleAudioFocus\s*=\s*\*\/\s*true/.test(engine))
  check('AudioAttributes marked as music/media',
    engine.includes('C.USAGE_MEDIA') && engine.includes('C.AUDIO_CONTENT_TYPE_MUSIC'))
  check('handles becoming-noisy (headphones unplugged)',
    engine.includes('setHandleAudioBecomingNoisy(true)'))
  check('no manual AudioManager focus request',
    !engine.includes('requestAudioFocus'))
  check('no forced volume restoration',
    !/setVolume\(1(\.0f?)?\)/.test(engine))

  // Media buttons must arrive through the session, not a custom receiver.
  const svc = read(SERVICE)
  check('no custom BroadcastReceiver for media buttons',
    !svc.includes('BroadcastReceiver'))
}

// ------------------------------------------------------------
group('9. Notification actions reuse the same player')
// ------------------------------------------------------------
{
  const svc = read(SERVICE)
  // The session wraps the engine's player directly, so the notification's
  // play/pause/next/previous are Player commands on that instance —
  // there is no separate navigation implementation to diverge.
  check('session is built over the engine player',
    /MediaSession\.Builder\(this,\s*player\)/.test(svc))
  check('no duplicate next/previous logic in the service',
    !svc.includes('seekToNextMediaItem') && !svc.includes('seekToPreviousMediaItem'))
  check('service never touches Pinia/WebView',
    !svc.includes('notifyListeners') && !svc.includes('WebView'))

  // Phase 2 semantics stay in the engine, the single place they exist.
  const engine = read(ENGINE)
  check('repeat-one skip semantics still in the engine',
    engine.includes('REPEAT_MODE_ONE') && engine.includes('fun next()'))
  check('previous threshold still in the engine',
    engine.includes('restartThresholdMs'))
}

// ------------------------------------------------------------
group('10. Notification permission handling')
// ------------------------------------------------------------
{
  const plugin = read(PLUGIN)
  check('getNotificationPermission exposed', plugin.includes('fun getNotificationPermission'))
  check('requestNotificationPermission exposed', plugin.includes('fun requestNotificationPermission'))
  check('gated on API 33+ (TIRAMISU)', plugin.includes('Build.VERSION_CODES.TIRAMISU'))
  check('resolves without prompting below API 33',
    /SDK_INT < Build\.VERSION_CODES\.TIRAMISU[\s\S]{0,200}call\.resolve/.test(plugin))
  check('uses a PermissionCallback, never throws', plugin.includes('@PermissionCallback'))
  check('permission alias registered', plugin.includes('Permission(alias = "notifications"'))

  const composable = read(NATIVE_COMPOSABLE)
  check('permission is requested once, not per track',
    composable.includes('notificationPermissionAsked'))
  check('denial is logged, never fatal',
    /result\.granted[\s\S]{0,300}console\.info/.test(composable))
  check('playback does not await the permission result',
    composable.includes('void ensureNotificationPermission()'))
}

// ------------------------------------------------------------
group('11. Foreground reconciliation (Pinia <- native)')
// ------------------------------------------------------------
{
  const c = read(NATIVE_COMPOSABLE)
  check('reconcile function exists', c.includes('async function reconcileWithNative'))
  check('runs on visibilitychange', c.includes("addEventListener('visibilitychange'"))
  check('runs on window focus', c.includes("addEventListener('focus'"))
  check('listeners removed on dispose',
    c.includes("removeEventListener('visibilitychange'")
    && c.includes("removeEventListener('focus'"))
  check('reads authoritative state from the engine', c.includes('await getStateNative()'))
  check('realigns the queue from native', c.includes('await getQueueNative()'))
  check('authoritative snapshots bypass the stale-event guard',
    c.includes('applySnapshot(snapshot, /* authoritative */ true)'))
  check('does not clear state when native has nothing to say',
    /if \(!snapshot\) return/.test(c))
  check('partial queues are rejected rather than dropping tracks',
    c.includes('resolved.length !== native.trackIds.length'))
  check('no polling interval for reconciliation',
    !/setInterval\([^)]*reconcile/.test(c))
}

// ------------------------------------------------------------
group('12. Typed Capacitor contract, no `any`')
// ------------------------------------------------------------
{
  const ts = read(PLUGIN_TS)
  check('NotificationPermissionState declared', ts.includes('export interface NotificationPermissionState'))
  check('getNotificationPermission typed',
    ts.includes('getNotificationPermission(): Promise<NotificationPermissionState>'))
  check('requestNotificationPermission typed',
    ts.includes('requestNotificationPermission(): Promise<NotificationPermissionState>'))
  check('no `any` in the plugin contract', !/\bany\b/.test(ts))

  // Existing Phase 2 API must be untouched.
  for (const method of ['play(', 'pause()', 'resume()', 'next()', 'previous()', 'setQueue(', 'getState()']) {
    check(`existing API preserved: ${method}`, ts.includes(method))
  }
}

// ------------------------------------------------------------
group('13. Web fallback still guarded')
// ------------------------------------------------------------
{
  const svc = read(SERVICE_TS)
  const c = read(NATIVE_COMPOSABLE)
  check('service layer guards on native availability',
    svc.includes('if (!isNativePlayerAvailable()) return null'))
  check('notification permission resolves safely on web',
    svc.includes('return result ?? { granted: true, required: false }'))
  check('native init bails when the plugin is absent',
    c.includes('if (!isNativePlayerAvailable()) return false'))
  check('reconciliation is client-only guarded',
    c.includes('if (!import.meta.client || installed) return false'))
  check('dispose guards DOM access with import.meta.client',
    /function dispose\(\)[\s\S]{0,200}if \(import\.meta\.client\)/.test(c))
}

// ------------------------------------------------------------
group('14. Artwork strategy unchanged (no bitmaps, no Base64)')
// ------------------------------------------------------------
{
  const engine = read(ENGINE)
  check('artwork passed as a URI reference', engine.includes('setArtworkUri'))
  check('no Base64 encoding', !engine.includes('Base64'))
  check('no bitmap decoding in the engine',
    !engine.includes('BitmapFactory') && !engine.includes('setArtworkData'))
  check('metadata carries title/artist/album',
    engine.includes('setTitle') && engine.includes('setArtist') && engine.includes('setAlbumTitle'))
  check('mediaId remains the stable SYSTEMA track id',
    engine.includes('.setMediaId(track.id)'))
}

// ------------------------------------------------------------
group('15. Phase 2 behaviour preserved')
// ------------------------------------------------------------
{
  const engine = read(ENGINE)
  check('single engine singleton retained', engine.includes('private var instance: PlayerEngine?'))
  check('queue still lives in the Media3 playlist', engine.includes('trackIds'))
  check('shuffle still delegated to Media3', engine.includes('shuffleModeEnabled'))
  check('repeat modes still mapped', engine.includes('REPEAT_MODE_ALL'))
  check('error-skip behaviour retained', engine.includes('seekToNextMediaItem'))

  const plugin = read(PLUGIN)
  check('plugin still detaches (not releases) on destroy',
    plugin.includes('engine.removeListener(engineListener)'))
  check('plugin does not release the engine on Activity destroy',
    !/handleOnDestroy\(\)[\s\S]{0,300}engine\.release\(\)/.test(plugin))
}

// ------------------------------------------------------------
console.log(`\n\x1b[1mResults:\x1b[0m ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
