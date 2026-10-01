import { Stack } from 'expo-router';

import { Palette } from '@/constants/theme';
import { LooksProvider } from '@/hooks/use-looks';
import { PlanProvider } from '@/hooks/use-plan';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  return (
    // The plan wraps the library rather than the other way round: what the app has
    // left to give is a smaller fact than what it holds, and the try-on screen
    // needs both.
    <PlanProvider>
      <LooksProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Palette.background },
            animation: 'slide_from_right',
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="tryon" />
          <Stack.Screen name="look" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="paywall" />
        </Stack>
      </LooksProvider>
    </PlanProvider>
  );
}
