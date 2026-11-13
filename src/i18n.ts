/**
 * UI strings in English and Korean. The language follows Stash's own
 * interface language (Settings -> Interface -> Language): Korean for ko-*,
 * English for everything else. Resolved on every call, so a language change
 * in Stash applies without reloading this plugin.
 */

const en = {
  toggleLabel: 'Handy Invert',
  on: 'ON',
  off: 'OFF',
  unknown: '…',
  tooltipGlobal: 'Global setting: inverts the Handy (L0) stroke direction for every scene.',
  tooltipStored: 'Stored in the Stash server settings (config.yml), not just this browser.',
  tooltipPrepared: 'Script prepared on the device: {state}',
  preparedInverted: 'inverted',
  preparedOriginal: 'original',
  badgeBlocked: '⚠ Playback blocked',
  badgeNextUpload: 'Applies on next play',
  badgeDoubleInvert: '⚠ Double invert',
  toastApplied: 'Handy Invert {state} applied',
  toastResume: ' - press play to resume',
  toastExternalApplied: 'Handy Invert was turned {state} elsewhere and has been applied - press play to resume',
  toastExternalPending: 'Handy Invert was turned {state} elsewhere. It applies when you press play.',
  toastReprepared: 'The device was prepared again for Handy Invert {state} - press play',
  errNotObject: 'The script is not a JSON object',
  errNoActions: 'The script has no actions',
  errAction: 'Action #{i} is not valid',
  errAt: 'Action #{i} has an invalid time (at)',
  errPos: 'Action #{i} has a position (pos) outside 0-{max}',
  errRange: 'The script has an invalid range',
  errFetch: 'Could not load the funscript (HTTP {status})',
  errSettings: 'Could not read the Global Invert setting from the Stash server',
  errLegacySit:
    'The installed StashInteractiveTools has no extension API, so the invert cannot be applied. Playback was blocked. Install a SIT build with the extension API or turn Invert off.',
  errHostedFunscript:
    "Scripts cannot be inverted while Stash's 'Use Stash hosted funscript' option is on. Turn that option off or turn Invert off.",
  errHandyToken:
    'Handy token scripts cannot be inverted because their content is not visible. Playback was blocked (turn Invert off to play it).',
  errIvdb:
    'ivdb scripts cannot be inverted because their content is not visible. Playback was blocked (turn Invert off to play it).',
  errOpaque: 'This script cannot be inverted. Playback was blocked.',
  warnCustomInvert:
    'A SIT Custom modifier already inverts (100 - pos). Combined with Global Invert the direction flips back. Remove that preset.',
};

export type MessageKey = keyof typeof en;

const ko: Record<MessageKey, string> = {
  toggleLabel: 'Handy 반전',
  on: 'ON',
  off: 'OFF',
  unknown: '…',
  tooltipGlobal: '전역 설정: 모든 영상에서 Handy(L0) 스트로크 방향을 반전합니다.',
  tooltipStored: '이 브라우저뿐 아니라 Stash 서버 설정(config.yml)에 저장됩니다.',
  tooltipPrepared: '기기에 준비된 스크립트: {state}',
  preparedInverted: '반전됨',
  preparedOriginal: '원본',
  badgeBlocked: '⚠ 재생 차단됨',
  badgeNextUpload: '다음 재생부터 적용',
  badgeDoubleInvert: '⚠ 이중 반전',
  toastApplied: 'Handy 반전 {state} 적용 완료',
  toastResume: ' - 재생을 다시 시작하세요',
  toastExternalApplied: '다른 곳에서 Handy 반전이 {state}(으)로 바뀌어 적용했습니다 - 재생을 다시 시작하세요',
  toastExternalPending: '다른 곳에서 Handy 반전이 {state}(으)로 바뀌었습니다. 재생을 누르면 적용됩니다.',
  toastReprepared: 'Handy 반전 {state}에 맞게 기기를 다시 준비했습니다 - 재생을 누르세요',
  errNotObject: '스크립트가 JSON 객체가 아닙니다',
  errNoActions: '스크립트에 동작(actions)이 없습니다',
  errAction: '동작 #{i}가 올바르지 않습니다',
  errAt: '동작 #{i}의 시간(at) 값이 올바르지 않습니다',
  errPos: '동작 #{i}의 위치(pos) 값이 0~{max} 범위를 벗어났습니다',
  errRange: '스크립트의 range 값이 올바르지 않습니다',
  errFetch: 'funscript를 불러오지 못했습니다 (HTTP {status})',
  errSettings: 'Stash 서버에서 Global Invert 설정을 읽지 못했습니다',
  errLegacySit:
    '설치된 StashInteractiveTools에 확장 API가 없어 반전을 적용할 수 없습니다. 재생을 차단했습니다. 확장 API가 포함된 SIT를 설치하거나 반전을 끄세요.',
  errHostedFunscript:
    "Stash의 'Use Stash hosted funscript' 옵션이 켜져 있으면 반전할 수 없습니다. 이 옵션을 끄거나 반전을 끄세요.",
  errHandyToken:
    'Handy 토큰 스크립트는 내용을 볼 수 없어 반전할 수 없습니다. 재생을 차단했습니다 (반전을 끄면 재생됩니다).',
  errIvdb:
    'ivdb 스크립트는 내용을 볼 수 없어 반전할 수 없습니다. 재생을 차단했습니다 (반전을 끄면 재생됩니다).',
  errOpaque: '이 스크립트는 반전할 수 없습니다. 재생을 차단했습니다.',
  warnCustomInvert:
    'SIT Custom 모디파이어에 이미 반전식(100 - pos)이 있습니다. Global Invert와 겹쳐 원래 방향으로 돌아갑니다. 해당 프리셋을 해제하세요.',
};

export type Locale = 'en' | 'ko';
const catalogs: Record<Locale, Record<MessageKey, string>> = { en, ko };

let languageSource: () => string | null | undefined = () => undefined;

/** where to read Stash's interface language from (e.g. "ko-KR", "en-GB") */
export function setLanguageSource(source: () => string | null | undefined) {
  languageSource = source;
}

export function currentLocale(): Locale {
  let language: string | null | undefined;
  try {
    language = languageSource();
  } catch {
    language = undefined;
  }
  return language?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}) {
  const template = catalogs[currentLocale()][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** "ON"/"OFF" in the current language */
export const stateLabel = (enabled: boolean) => t(enabled ? 'on' : 'off');
