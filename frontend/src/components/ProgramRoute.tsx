import { Navigate, useLocation } from 'react-router';
import { useProgram } from '../contexts/ProgramContext';

export function ProgramRoute() {
  const { currentProgram } = useProgram();
  const location = useLocation();
  
  // If a program is already selected, redirect to it
  if (currentProgram) {
    const redirectPath = currentProgram === 'summer' ? '/summer/sessions' : '/family/';
    return <Navigate to={redirectPath} state={{ from: location }} replace />;
  }
  
  // Otherwise, show the program selection page
  return null;
}