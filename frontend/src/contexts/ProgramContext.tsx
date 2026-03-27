import { type ReactNode, createContext, useContext, useState, useEffect, useCallback } from 'react'

export type Program = 'summer' | 'weekend' | 'analytics'

interface ProgramContextType {
  currentProgram: Program | null
  setProgram: (program: Program) => void
  clearProgram: () => void
}

const ProgramContext = createContext<ProgramContextType | undefined>(undefined)

const STORAGE_KEY = 'bunking-program-selection'

// Migrate old stored values to new program names
function migrateStoredProgram(stored: string | null): Program | null {
  if (stored === 'family') return 'weekend'
  if (stored === 'metrics') return 'analytics'
  if (stored === 'summer' || stored === 'weekend' || stored === 'analytics') {
    return stored
  }
  return null
}

export function ProgramProvider({ children }: { children: ReactNode }) {
  const [currentProgram, setCurrentProgram] = useState<Program | null>(() => {
    return migrateStoredProgram(localStorage.getItem(STORAGE_KEY))
  })

  useEffect(() => {
    if (currentProgram) {
      localStorage.setItem(STORAGE_KEY, currentProgram)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [currentProgram])

  const setProgram = useCallback((program: Program) => {
    setCurrentProgram(program)
  }, [])

  const clearProgram = useCallback(() => {
    setCurrentProgram(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <ProgramContext.Provider value={{ currentProgram, setProgram, clearProgram }}>
      {children}
    </ProgramContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProgram() {
  const context = useContext(ProgramContext)
  if (!context) {
    throw new Error('useProgram must be used within a ProgramProvider')
  }
  return context
}
