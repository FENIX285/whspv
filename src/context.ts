import { createContext, useContext, useState, useEffect } from 'react';
import { UserContextType } from './types';

export const UserContext = createContext<UserContextType | null>(null);

export function useUser() {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within UserProvider");
  return context;
}
