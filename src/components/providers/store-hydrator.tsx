"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAppStore } from '@/store';

interface StoreHydratorContextType {
  isHydrated: boolean;
}

const StoreHydratorContext = createContext<StoreHydratorContextType>({
  isHydrated: false,
});

export function StoreHydrator({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const initSettings = useAppStore((state) => state.initSettings);

  useEffect(() => {
    initSettings().finally(() => {
      setIsHydrated(true);
    });
  }, [initSettings]);

  return (
    <StoreHydratorContext.Provider value={{ isHydrated }}>
      {children}
    </StoreHydratorContext.Provider>
  );
}

export function useStoreHydration() {
  return useContext(StoreHydratorContext);
}
