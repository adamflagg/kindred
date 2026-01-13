import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Program = 'summer' | 'family';

interface ProgramContextType {
  currentProgram: Program | null;
  setProgram: (program: Program) => void;
  clearProgram: () => void;
}

const ProgramContext = createContext<ProgramContextType | undefined>(undefined);

const STORAGE_KEY = 'bunking-program-selection';

export function ProgramProvider({ children }: { children: React.ReactNode }) {
  const [currentProgram, setCurrentProgram] = useState<Program | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'summer' || stored === 'family') {
      return stored;
    }
    return null;
  });

  useEffect(() => {
    if (currentProgram) {
      localStorage.setItem(STORAGE_KEY, currentProgram);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [currentProgram]);

  const setProgram = useCallback((program: Program) => {
    setCurrentProgram(program);
  }, []);

  const clearProgram = useCallback(() => {
    setCurrentProgram(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <ProgramContext.Provider value={{ currentProgram, setProgram, clearProgram }}>
      {children}
    </ProgramContext.Provider>
  );
}

export function useProgram() {
  const context = useContext(ProgramContext);
  if (!context) {
    throw new Error('useProgram must be used within a ProgramProvider');
  }
  return context;
}