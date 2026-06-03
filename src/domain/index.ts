export { solve } from './solver'
export { computeTier, pickUplinkGroup } from './tier'
export { computeSpine } from './spine'
export { placeRacks, synthesizeLogicalLayout, LOGICAL_FABRIC_RACK_NAME } from './rack'
export {
  checkUseCaseConstraints,
  candidateLeavesFor,
  candidateSpinesFor,
  requiresNonBlocking
} from './use-case'
export {
  buildCandidates,
  distributeEvenly,
  pickPrimaryCandidate,
  annotateMultiPodLayout,
  IPN_PORTS_PER_SPINE_PER_IPN,
  IPN_HA_MIN,
  IPN_RACK_NAME,
  IPN_RACK_SIZE_U
} from './multipod'
export { ipnRouterSpecFromFileEntry, pickIpnRouter } from './ipn'
export {
  BreakoutPairSchema,
  BreakoutPairsFileSchema,
  IpnRouterSchema,
  IpnRoutersFileSchema
} from './types'
export type {
  BreakoutAnalysis,
  BreakoutPair,
  BreakoutPairsFile,
  BreakoutVariant,
  CandidateId,
  DesignCandidate,
  DesignResult,
  DesignSummary,
  FabricRequest,
  InputMode,
  IpnRouterCapabilitiesSpec,
  IpnRouterFileEntry,
  IpnRoutersFile,
  IpnRouterSpec,
  MultiPodAnalysis,
  OpticsBomEntry,
  OpticsBomScenario,
  PodVariant,
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
