import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DARK, LIGHT } from '../constants/themes';

const THEME_KEY = 'kudora_theme';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  // Default to dark immediately so first paint is never a white flash
  const [mode, setMode] = useState('dark');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') setMode(saved);
    });
  }, []);

  const toggleTheme = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    AsyncStorage.setItem(THEME_KEY, next);
  };

  const isDark = mode === 'dark';
  const T = isDark ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ mode, T, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
