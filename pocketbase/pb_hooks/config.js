// Configuration module for PocketBase hooks
// Returns configuration object with solver service settings

module.exports = function() {
  const SOLVER_HOST = $os.getenv("SOLVER_HOST") || "bunking-solver";
  const SOLVER_PORT = $os.getenv("SOLVER_PORT") || "8000";
  const IS_DOCKER = $os.getenv("IS_DOCKER") === "true";
  
  const SOLVER_URL = IS_DOCKER 
    ? `http://${SOLVER_HOST}:${SOLVER_PORT}`
    : `http://localhost:${SOLVER_PORT}`;
  
  return {
    SOLVER_HOST,
    SOLVER_PORT,
    IS_DOCKER,
    SOLVER_URL
  };
};