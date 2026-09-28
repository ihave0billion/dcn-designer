export { solve } from './solver'
export { computeTier, pickUplinkGroup } from './tier'
export { computeSpine } from './spine'
export {
  placeRacks,
  synthesizeLogicalLayout,
  LOGICAL_FABRIC_RACK_NAME,
  DEFAULT_RU,
  DEFAULT_SWITCH_POWER_W
} from './rack'
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
  effectiveVpcSettings,
  peerLinkGroupFor,
  uplinkBudgetAfterPeerLink,
  pairLeaves,
  pairLeavesFromTiers,
  DEFAULT_FABRIC_MODE,
  DEFAULT_PEER_LINK_MEMBERS,
  PEER_LINK_MEMBERS_MIN,
  PEER_LINK_MEMBERS_MAX
} from './vpc'
export type { EffectiveVpcSettings, PeerLinkGroupChoice, UplinkBudget, PairingResult } from './vpc'
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
  FabricMode,
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
  PortGroupName,
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
  VpcPair,
  VpcSummary,
  WarningCode
} from './types'
