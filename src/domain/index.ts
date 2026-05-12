export { solve } from './solver'
export { computeTier, pickUplinkGroup } from './tier'
export { computeSpine } from './spine'
export { placeRacks } from './rack'
export {
  checkUseCaseConstraints,
  candidateLeavesFor,
  candidateSpinesFor,
  requiresNonBlocking
} from './use-case'
export {
  BreakoutPairSchema,
  BreakoutPairsFileSchema
} from './types'
export type {
  BreakoutAnalysis,
  BreakoutPair,
  BreakoutPairsFile,
  DesignResult,
  DesignSummary,
  FabricRequest,
  InputMode,
  OpticsBomEntry,
  OpticsBomScenario,
  PortGroupSpec,
  RackDevicePlacement,
  RackInventoryEntry,
  RackPlacement,
  ServerSpec,
  SolverContext,
  SolverRequirements,
  SolverWarning,
  SpineResult,
  SwitchCapabilitiesSpec,
  SwitchSpec,
  TierRequest,
  TierResult,
  UplinkChoice,
  UseCase,
  WarningCode
} from './types'
