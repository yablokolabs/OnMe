import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { MaxContentWidth, Palette, Spacing } from '@/constants/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Wrap the content in a ScrollView (used by every screen with long content). */
  scroll?: boolean;
  /** Rendered inside the safe area, above the scroll area. */
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: readonly Edge[];
  /** Raises the keyboard instead of covering inputs. */
  keyboardAvoiding?: boolean;
  /** Vertically centre short content (used by result states). */
  centered?: boolean;
}

const DEFAULT_EDGES: readonly Edge[] = ['top', 'left', 'right', 'bottom'];

/**
 * The shell every screen sits in.
 *
 * There is deliberately **no footer slot**. A screen's one action belongs at the
 * end of its content, where it can be read in order, rather than pinned in a bar
 * that floats above the story it belongs to — and a pinned bar is also the place
 * product messaging quietly turns into branding clutter.
 */
export function Screen({
  children,
  scroll = false,
  header,
  contentStyle,
  edges = DEFAULT_EDGES,
  keyboardAvoiding = false,
  centered = false,
}: ScreenProps) {
  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.scrollContent,
        centered && styles.centeredContent,
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, centered && styles.centeredContent, contentStyle]}>
      {children}
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea} edges={edges}>
        {header}
        {keyboardAvoiding ? (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  centeredContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
