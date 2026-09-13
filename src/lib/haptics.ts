import * as Haptics from 'expo-haptics';

/**
 * Haptic feedback, iOS only and never awaited.
 *
 * iOS only because that is where the Taptic Engine makes a tap feel confirmed;
 * Android's generic vibration for the same gesture reads as a buzz, and web has
 * nothing. Every call is fire-and-forget with a swallowed rejection: feedback
 * that fails must never interfere with the action it was decorating.
 */

const enabled = process.env.EXPO_OS === 'ios';

/** A wishlist toggle landed. */
export function hapticToggle(): void {
  if (!enabled) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A wishlist toggle failed and was rolled back. */
export function hapticError(): void {
  if (!enabled) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
