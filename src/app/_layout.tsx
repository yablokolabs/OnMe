import { Stack } from 'expo-router';

import { Palette } from '@/constants/theme';
import { LooksProvider } from '@/hooks/use-looks';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  return (
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
      </Stack>
    </LooksProvider>
  );
}
