import { Toaster } from 'sonner';
import { useTheme } from '@/context/ThemeContext';

/**
 * Sonner toaster wired to the app theme so notifications follow dark mode and
 * match the design system (Inter font, rounded-xl, themed border).
 */
export default function ThemedToaster() {
  const { theme } = useTheme();

  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      theme={theme}
      toastOptions={{
        style: {
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          borderRadius: '0.75rem',
        },
      }}
    />
  );
}
