import { createContext, useContext, useState, useEffect } from 'react';

export const THEMES = [
  { id: 'aurora', name: 'Aurora', mode: 'dark' },
  { id: 'emerald', name: 'Emerald (Mặc định)', mode: 'light' },
  { id: 'light', name: 'Light', mode: 'light' },
  { id: 'dark', name: 'Dark', mode: 'dark' },
  { id: 'nord', name: 'Nord', mode: 'light' },
  { id: 'sunset', name: 'Sunset', mode: 'dark' },
  { id: 'cupcake', name: 'Cupcake', mode: 'light' },
  { id: 'corporate', name: 'Corporate', mode: 'light' },
  { id: 'synthwave', name: 'Synthwave', mode: 'dark' },
  { id: 'cyberpunk', name: 'Cyberpunk', mode: 'light' },
  { id: 'dracula', name: 'Dracula', mode: 'dark' },
  { id: 'dim', name: 'Dim', mode: 'dark' },
  { id: 'autumn', name: 'Autumn', mode: 'light' },
  { id: 'night', name: 'Night', mode: 'dark' },
  { id: 'coffee', name: 'Coffee', mode: 'dark' },
  { id: 'winter', name: 'Winter', mode: 'light' },
  { id: 'silk', name: 'Silk', mode: 'light' },
];

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('app-theme') || 'emerald';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  const changeTheme = (newTheme) => {
    setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, changeTheme, availableThemes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
