import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarBreakpoint } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function TabLayout() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const sidebar = width >= SidebarBreakpoint;

  return (
    <Tabs
      screenOptions={{
        tabBarPosition: sidebar ? 'left' : 'bottom',
        tabBarLabelPosition: sidebar ? 'beside-icon' : 'below-icon',
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        // The sidebar variant otherwise fills the active item with the accent,
        // which hides an accent-coloured label on top of it.
        tabBarActiveBackgroundColor: sidebar ? theme.backgroundSelected : undefined,
        tabBarStyle: { backgroundColor: theme.background, borderColor: theme.border },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerRight: () => <ThemeToggle />,
        // Deliberately not setting popToTopOnBlur: leaving a tab must keep its
        // scroll position and filters exactly where the user left them.
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => <Icon name="discover" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="wishlist"
        options={{
          title: 'Wishlist',
          tabBarIcon: ({ color, size }) => <Icon name="wishlist" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
