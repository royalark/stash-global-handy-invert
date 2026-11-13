import { afterEach, describe, expect, it } from 'vitest';
import { currentLocale, setLanguageSource, stateLabel, t } from '../src/i18n';

afterEach(() => setLanguageSource(() => undefined));

describe('i18n', () => {
  it('defaults to English (Stash default en-GB, or unknown)', () => {
    expect(currentLocale()).toBe('en');
    setLanguageSource(() => 'en-GB');
    expect(t('badgeBlocked')).toBe('⚠ Playback blocked');
    setLanguageSource(() => 'de-DE');
    expect(currentLocale()).toBe('en');
  });

  it('follows Stash when it is set to Korean', () => {
    setLanguageSource(() => 'ko-KR');
    expect(currentLocale()).toBe('ko');
    expect(t('badgeBlocked')).toBe('⚠ 재생 차단됨');
    expect(t('toggleLabel')).toBe('Handy 반전');
  });

  it('switches at call time when the language changes', () => {
    let lang = 'en-US';
    setLanguageSource(() => lang);
    expect(t('preparedInverted')).toBe('inverted');
    lang = 'ko-KR';
    expect(t('preparedInverted')).toBe('반전됨');
  });

  it('fills placeholders in both languages', () => {
    expect(t('errPos', { i: 3, max: 100 })).toBe('Action #3 has a position (pos) outside 0-100');
    setLanguageSource(() => 'ko-KR');
    expect(t('errPos', { i: 3, max: 100 })).toBe('동작 #3의 위치(pos) 값이 0~100 범위를 벗어났습니다');
    expect(t('toastApplied', { state: stateLabel(true) })).toBe('Handy 반전 ON 적용 완료');
  });

  it('a broken language source falls back to English', () => {
    setLanguageSource(() => {
      throw new Error('no cache');
    });
    expect(currentLocale()).toBe('en');
  });
});
